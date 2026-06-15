from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager
import httpx
import os
import logging
from openai import AsyncOpenAI
import tiktoken
import json
import hashlib
import asyncio

from shared.consul_discovery import ConsulRegistry

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Service URLs (resolved at startup via Consul, fallback to env vars / defaults)
STORAGE_SERVICE = os.getenv("STORAGE_SERVICE_URL", "http://storage-service:8005")
CACHE_SERVICE = os.getenv("CACHE_SERVICE_URL", "http://cache-service:8006")
SETTINGS_SERVICE = os.getenv("SETTINGS_SERVICE_URL", "http://settings-service:8007")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global STORAGE_SERVICE, CACHE_SERVICE, SETTINGS_SERVICE
    consul = ConsulRegistry(consul_host=os.getenv("CONSUL_HOST", "consul"))
    port = int(os.getenv("PORT", "8003"))
    await consul.register("query-service", port, tags=["llm", "rag"])

    for name, attr in [("storage-service", "STORAGE_SERVICE"),
                        ("cache-service", "CACHE_SERVICE"),
                        ("settings-service", "SETTINGS_SERVICE")]:
        cur = globals()[attr]
        resolved = await consul.get_service_url(name, cur)
        if resolved and resolved != cur:
            globals()[attr] = resolved
            logger.info(f"Query service: resolved {attr} via Consul: {resolved}")

    yield
    await consul.close()


app = FastAPI(title="Query Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class QueryRequest(BaseModel):
    question: str
    document_id: Optional[int] = None
    use_cache: bool = True
    include_citations: bool = True

class QueryResponse(BaseModel):
    question: str
    answer: str
    citations: List[Dict[str, Any]] = []
    tokens_used: int
    cost: float
    cached: bool = False
    relevant_nodes: List[str] = []
    thinking: str = ""
    num_documents_queried: int = 0

# Helper functions from PageIndex approach
def remove_fields(data, fields=['text']):
    """Remove specified fields from nested dict/list structure"""
    if isinstance(data, dict):
        return {k: remove_fields(v, fields)
                for k, v in data.items() if k not in fields}
    elif isinstance(data, list):
        return [remove_fields(item, fields) for item in data]
    return data

def create_node_mapping(tree: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Create a flat mapping of node_id -> node data"""
    node_map = {}

    def traverse(node):
        if isinstance(node, dict):
            # If node has an ID, add to map
            if 'node_id' in node:
                node_map[node['node_id']] = node

            # Recursively traverse children
            if 'children' in node and isinstance(node['children'], list):
                for child in node['children']:
                    traverse(child)

            # Also traverse other nested structures
            for value in node.values():
                if isinstance(value, (dict, list)):
                    traverse(value)
        elif isinstance(node, list):
            for item in node:
                traverse(item)

    traverse(tree)
    return node_map

def count_tokens(text: str, model: str = "gpt-4o-2024-11-20") -> int:
    """Count tokens in text"""
    try:
        base_model = "gpt-4o" if "gpt-4o" in model else model
        encoding = tiktoken.encoding_for_model(base_model)
        return len(encoding.encode(text))
    except Exception as e:
        try:
            encoding = tiktoken.get_encoding("cl100k_base")
            return len(encoding.encode(text))
        except Exception:
            logger.warning(f"Token counting failed: {e}, using estimate")
            return len(text) // 4

def calculate_cost(tokens: int, model: str) -> float:
    """Calculate cost based on tokens and model (prices per million tokens)"""
    if LLM_PROVIDER == "ollama":
        return 0.0

    costs = {
        "gpt-4o": {"input": 2.50, "output": 10.00},
        "gpt5": {"input": 1.25, "output": 10.00},
        "gpt5-mini": {"input": 0.25, "output": 2.00},
        "gpt5-nano": {"input": 0.05, "output": 0.40},
    }

    base_model = model if model in costs else "gpt-4o"

    # Assume roughly 2/3 input, 1/3 output
    input_tokens = tokens * 0.66
    output_tokens = tokens * 0.34

    # Prices are per million tokens
    cost = (input_tokens / 1_000_000 * costs[base_model]["input"] +
            output_tokens / 1_000_000 * costs[base_model]["output"])

    return round(cost, 6)

def generate_cache_key(question: str, document_id: Optional[int]) -> str:
    """Generate cache key from question and document ID"""
    doc_id_str = str(document_id) if document_id is not None else "all"
    content = f"{question}:{doc_id_str}"
    return hashlib.md5(content.encode()).hexdigest()

async def call_llm(prompt: str, api_key: str, model: str, temperature: float = 0.3, max_tokens: int = 3000) -> tuple[str, int]:
    """Call LLM (OpenAI or Ollama) and return response with token count"""
    try:
        if LLM_PROVIDER == "ollama":
            client = AsyncOpenAI(
                base_url=f"{OLLAMA_BASE_URL}/v1",
                api_key="ollama"
            )
        else:
            client = AsyncOpenAI(api_key=api_key)

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt}
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )

        content = response.choices[0].message.content.strip()
        tokens = response.usage.total_tokens if response.usage else len(content) // 4

        return content, tokens
    except Exception as e:
        logger.error(f"LLM call failed: {e}")
        raise HTTPException(status_code=500, detail=f"LLM call failed: {str(e)}")

async def get_api_key() -> str:
    """Get OpenAI API key from Settings Service"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{SETTINGS_SERVICE}/get-key")
            if response.status_code == 200:
                data = response.json()
                return data.get("key", "")
            else:
                raise HTTPException(status_code=500, detail="Failed to get API key")
    except Exception as e:
        logger.error(f"Error getting API key: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get API key: {str(e)}")

async def get_model_config() -> Dict[str, Any]:
    """Get model configuration from Settings Service"""
    default_model = "llama3.2:3b" if LLM_PROVIDER == "ollama" else "gpt-4o-2024-11-20"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{SETTINGS_SERVICE}/settings/model")
            if response.status_code == 200:
                config = response.json()
                if LLM_PROVIDER == "ollama" and "llama3.2" not in config.get("model", ""):
                    config["model"] = default_model
                if config.get("max_tokens", 4096) < 2048:
                    config["max_tokens"] = 4096
                return config
            else:
                return {
                    "model": default_model,
                    "temperature": 0.7,
                    "max_tokens": 4096,
                }
    except Exception as e:
        logger.warning(f"Failed to get model config: {e}, using defaults")
        return {
            "model": default_model,
            "temperature": 0.7,
            "max_tokens": 4096,
        }

async def get_query_settings() -> Dict[str, Any]:
    """Get query settings from Settings Service"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{SETTINGS_SERVICE}/settings/query")
            if response.status_code == 200:
                return response.json()
            else:
                return {
                    "max_context_nodes": 5,
                    "citation_style": "inline",
                    "cache_ttl_hours": 24,
                }
    except Exception as e:
        logger.warning(f"Failed to get query settings: {e}, using defaults")
        return {
            "max_context_nodes": 5,
            "citation_style": "inline",
            "cache_ttl_hours": 24,
        }

async def get_tree_from_storage(document_id: int) -> Dict[str, Any]:
    """Get tree structure from Storage Service"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{STORAGE_SERVICE}/trees/document/{document_id}")
            if response.status_code == 200:
                return response.json()
            else:
                raise HTTPException(status_code=404, detail="Tree not found for document")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=404, detail="Tree not found for document")
    except Exception as e:
        logger.error(f"Error getting tree: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get tree: {str(e)}")

async def check_cache(cache_key: str) -> Optional[Dict[str, Any]]:
    """Check if query result is cached"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{CACHE_SERVICE}/cache/{cache_key}")
            if response.status_code == 200:
                data = response.json()
                if data.get("found"):
                    return data.get("value")
    except Exception as e:
        logger.warning(f"Cache check failed: {e}")
    return None

async def store_in_cache(cache_key: str, value: Dict[str, Any], ttl: int = 86400):
    """Store query result in cache"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{CACHE_SERVICE}/cache",
                json={"key": cache_key, "value": value, "ttl": ttl}
            )
    except Exception as e:
        logger.warning(f"Cache store failed: {e}")

async def get_documents_with_trees() -> List[Dict[str, Any]]:
    """Fetch all indexed documents with their trees from storage service"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            doc_response = await client.get(f"{STORAGE_SERVICE}/documents")
            if doc_response.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to fetch documents")

            docs = doc_response.json().get("documents", [])
            indexed_docs = [d for d in docs if d.get("status") == "indexed" and d.get("tree_id")]

            if not indexed_docs:
                raise HTTPException(status_code=404, detail="No indexed documents found")

            async def fetch_tree(doc):
                try:
                    tree_resp = await client.get(f"{STORAGE_SERVICE}/trees/document/{doc['id']}")
                    if tree_resp.status_code == 200:
                        tree_data = tree_resp.json()
                        return {
                            "doc_id": doc["id"],
                            "filename": doc["filename"],
                            "tree": tree_data.get("tree_data", {})
                        }
                except Exception:
                    pass
                return None

            tasks = [fetch_tree(doc) for doc in indexed_docs]
            results = await asyncio.gather(*tasks)
            return [r for r in results if r is not None]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching documents with trees: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch documents: {str(e)}")


def _annotate_node(node: dict, doc_id: int, filename: str):
    """Annotate a single node with source document info"""
    node["source_doc_id"] = doc_id
    node["source_filename"] = filename


def _annotate_tree(node: Any, doc_id: int, filename: str):
    """Recursively annotate all nodes with source document info"""
    if isinstance(node, dict):
        _annotate_node(node, doc_id, filename)
        for value in node.values():
            _annotate_tree(value, doc_id, filename)
    elif isinstance(node, list):
        for item in node:
            _annotate_tree(item, doc_id, filename)


# PageIndex-style two-stage retrieval
async def stage1_tree_search(
    question: str,
    tree: Dict[str, Any],
    api_key: str,
    model: str,
    filename: str = ""
) -> tuple[List[str], str, int]:
    """
    Stage 1: Tree Search (PageIndex approach)
    Pass tree structure (without text) to LLM and ask it to identify relevant node IDs
    Returns: (list of node_ids, thinking_process, tokens_used)
    """
    logger.info(f"Stage 1: Tree search with reasoning")

    # Remove text fields to reduce prompt size (PageIndex approach)
    tree_without_text = remove_fields(tree.copy(), fields=['text'])

    search_prompt = f"""You are given a document tree and must find nodes likely to contain information relevant to the user's request.

Rules:
- Include nodes whose titles could reasonably relate to the request topic
- For generic titles like "FAQ", "Section 1", "Introduction", "Overview", include the node if the document's filename or overall topic aligns with the request
- If no nodes seem relevant at all, return an empty list
- When in doubt, INCLUDE the node — the next stage will verify

Request: {question}
Document filename: {filename}

Document tree structure:
{json.dumps(tree_without_text, indent=2)}

Reply in JSON format:
{{
    "thinking": "<reasoning on which nodes match>",
    "node_list": ["node_id_1", ...]
}}
Output ONLY valid JSON."""

    # Call LLM
    result, tokens = await call_llm(search_prompt, api_key, model, temperature=0.3, max_tokens=2000)

    # Parse result
    try:
        result = result.strip()

        # Remove markdown code block fences if present
        if result.startswith("```"):
            lines = result.split("\n")
            json_lines = [l for l in lines if l.strip() and not l.strip().startswith("```")]
            result = "\n".join(json_lines)

        # Find the first { and last } to extract clean JSON
        start = result.find("{")
        end = result.rfind("}")
        if start != -1 and end != -1 and end > start:
            result = result[start:end+1]

        result_json = json.loads(result)
        node_list = result_json.get("node_list", [])
        thinking = result_json.get("thinking", "")

        logger.info(f"LLM thinking: {thinking}")
        logger.info(f"Selected {len(node_list)} nodes: {node_list}")

        return node_list, thinking, tokens
    except Exception as e:
        logger.warning(f"Failed to parse tree search result: {e}")
        logger.warning(f"Raw result (first 500): {result[:500]}")
        return [], "", tokens

async def stage2_answer_generation(
    question: str,
    node_list: List[str],
    node_map: Dict[str, Dict[str, Any]],
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int,
    citation_style: str,
    doc_results: Optional[List[Dict]] = None
) -> tuple[str, List[Dict[str, Any]], int]:
    """
    Stage 2: Answer Generation (PageIndex approach)
    Retrieve text from selected nodes and generate answer
    If doc_results is provided, uses per-document node lists/maps to avoid ID collisions.
    Returns: (answer, citations, tokens_used)
    """
    logger.info(f"Stage 2: Answer generation from {len(node_list)} nodes")

    relevant_content_parts = []
    citations = []
    seen_node_ids = set()

    if doc_results:
        for dr in doc_results:
            dnl = dr["node_list"]
            dmap = dr["node_map"]
            filename = dr["filename"]
            doc_id = dr["doc_id"]
            for node_id in dnl:
                if node_id in dmap and node_id not in seen_node_ids:
                    seen_node_ids.add(node_id)
                    node = dmap[node_id]
                    title = node.get("title", "Untitled")
                    start_page = node.get("start_index") or node.get("start_page", "?")
                    end_page = node.get("end_index") or node.get("end_page", "?")
                    text = node.get("text", "")
                    if text:
                        relevant_content_parts.append(f"[{filename}] [Node {node_id}: {title}, pages {start_page}-{end_page}]\n{text}\n")
                        citations.append({
                            "node_id": node_id,
                            "section": title,
                            "start_page": start_page,
                            "end_page": end_page,
                            "document_id": doc_id,
                            "document_filename": filename
                        })
    else:
        for node_id in node_list:
            if node_id in node_map:
                node = node_map[node_id]
                title = node.get("title", "Untitled")
                start_page = node.get("start_index") or node.get("start_page", "?")
                end_page = node.get("end_index") or node.get("end_page", "?")
                text = node.get("text", "")
                source_doc_id = node.get("source_doc_id")
                source_filename = node.get("source_filename")

                if text:
                    source_tag = f"[{source_filename}] " if source_filename else ""
                    relevant_content_parts.append(f"{source_tag}[Node {node_id}: {title}, pages {start_page}-{end_page}]\n{text}\n")
                    citation = {
                        "node_id": node_id,
                        "section": title,
                        "start_page": start_page,
                        "end_page": end_page
                    }
                    if source_doc_id:
                        citation["document_id"] = source_doc_id
                    if source_filename:
                        citation["document_filename"] = source_filename
                    citations.append(citation)
            else:
                logger.warning(f"Node ID {node_id} not found in node map")

    relevant_content = "\n\n".join(relevant_content_parts)

    if not relevant_content:
        logger.warning("No text content found in selected nodes")
        return "I couldn't find relevant content to answer this question.", [], 0

    # Truncate context to prevent overflow for small models (max ~6000 tokens ≈ 24000 chars)
    if len(relevant_content) > 24000:
        relevant_content = relevant_content[:24000] + "\n... [content truncated]"

    # Create answer prompt (PageIndex approach)
    if citation_style == "inline":
        citation_instruction = """When referencing information, cite the specific pages where it appears.
- The context contains <physical_index_X> tags marking each page
- Cite as: (pages X-Y) or (page X) based on which physical_index tags contain the information
- Example: "Risk factors include obesity and age over 55 (pages 7-9)"
- Use the most specific page range possible"""
    elif citation_style == "footnote":
        citation_instruction = """When referencing information, add footnote citations with specific page numbers.
- The context contains <physical_index_X> tags marking each page
- Add footnotes like [1], [2] at the end of sentences
- List sources at the end with specific pages based on physical_index tags"""
    else:
        citation_instruction = "Provide a clear answer based on the context."

    answer_prompt = f"""Read the context and answer the question. If the context doesn't have the answer, say "I cannot find this in the provided documents."

Context:
{relevant_content}

Question: {question}
{citation_instruction}

Answer:"""

    # Call LLM
    answer, tokens = await call_llm(answer_prompt, api_key, model, temperature=temperature, max_tokens=max_tokens)

    logger.info(f"Generated answer ({tokens} tokens)")
    return answer, citations, tokens

# API Endpoints
@app.get("/")
async def root():
    return {"service": "Query Service", "status": "running"}

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "query-service",
        "port": 8003,
        "version": "1.0.0"
    }

@app.post("/query", response_model=QueryResponse)
async def query_document(request: QueryRequest):
    """
    PageIndex-style two-stage retrieval:
    Stage 1: Tree search - LLM identifies relevant node IDs through reasoning
    Stage 2: Answer generation - Extract text from nodes and generate answer

    If document_id is None or 0, queries across ALL indexed documents.
    """
    doc_id = request.document_id
    logger.info(f"Processing query for document {doc_id or 'ALL'}: {request.question}")

    try:
        # Check cache first
        cached_result = None
        if request.use_cache:
            cache_key = generate_cache_key(request.question, doc_id)
            cached_result = await check_cache(cache_key)
            if cached_result:
                logger.info("Returning cached result")
                cached_result["cached"] = True
                return QueryResponse(**cached_result)

        # Get configuration
        api_key = await get_api_key()
        model_config = await get_model_config()
        query_settings = await get_query_settings()

        model = model_config.get("model", "gpt-4o-2024-11-20")
        temperature = model_config.get("temperature", 0.7)
        max_tokens = model_config.get("max_tokens", 3000)
        citation_style = query_settings.get("citation_style", "inline")

        tree = None
        doc_trees = None
        doc_results = None
        num_docs = 0

        if doc_id and doc_id > 0:
            tree_data = await get_tree_from_storage(doc_id)
            tree = tree_data.get("tree_data", {})
            if not tree:
                raise HTTPException(status_code=404, detail="No tree structure found for document")
            _annotate_tree(tree, doc_id, "document")
            num_docs = 1

            # Stage 1: Tree search (single document)
            node_list, thinking, tokens_stage1 = await stage1_tree_search(
                question=request.question,
                tree=tree,
                api_key=api_key,
                model=model
            )

            node_map = create_node_mapping(tree)

        else:
            doc_trees = await get_documents_with_trees()

            # Pre-filter: only run Stage 1 on documents whose filename shares keywords with the question
            STOPWORDS = {"what", "is", "the", "a", "an", "in", "of", "to", "and", "or", "for", "on", "with", "about", "does", "do", "are", "how", "why", "where", "when", "which", "who", "can", "will", "has", "have", "all", "list", "get", "tell", "show", "give", "find", "explain", "describe", "define"}

            def clean_word(w: str) -> str:
                return ''.join(c for c in w.lower() if c.isalnum())

            question_words = {clean_word(w) for w in request.question.split() if clean_word(w) not in STOPWORDS and len(clean_word(w)) > 2}

            def get_filename_keywords(filename: str) -> set:
                name = os.path.splitext(filename)[0].lower()
                words = set()
                for part in name.replace('-', ' ').replace('_', ' ').split():
                    part = ''.join(c for c in part if c.isalnum())
                    if part and part not in STOPWORDS and len(part) > 2:
                        words.add(part)
                return words

            # Soft pre-filter: narrow down to documents whose filename shares keywords with the question
            # If no document matches, fall back to searching all (tight Stage 1 prompt prevents over-matching)
            filtered = []
            for d in doc_trees:
                fname_keywords = get_filename_keywords(d["filename"])
                if question_words and (question_words & fname_keywords):
                    filtered.append(d)

            if filtered:
                doc_trees = filtered
                logger.info(f"Filename filter narrowed to {len(doc_trees)} doc(s): {[d['filename'] for d in doc_trees]}")
            else:
                logger.info(f"No filename match — searching all {len(doc_trees)} documents")

            num_docs = len(doc_trees)

            # Run Stage 1 per-document for accurate tree search
            all_node_lists = []
            all_thinking = []
            total_stage1_tokens = 0
            doc_results = []

            for dt in doc_trees:
                _annotate_tree(dt["tree"], dt["doc_id"], dt["filename"])
                nl, th, tk = await stage1_tree_search(
                    question=request.question,
                    tree=dt["tree"],
                    api_key=api_key,
                    model=model,
                    filename=dt["filename"]
                )
                all_node_lists.append(nl)
                total_stage1_tokens += tk

                if nl:
                    all_thinking.append(f"[{dt['filename']}] {th}")
                    doc_map = create_node_mapping(dt["tree"])
                    doc_results.append({
                        "doc_id": dt["doc_id"],
                        "filename": dt["filename"],
                        "node_list": nl,
                        "node_map": doc_map
                    })
                else:
                    all_thinking.append(f"[{dt['filename']}] No relevant nodes found")

            node_list = list(set(nid for nl in all_node_lists for nid in nl))
            thinking = "\n\n".join(all_thinking)
            tokens_stage1 = total_stage1_tokens
            node_map = {}
            tree = None

        if not node_list and not doc_results:
            logger.info(f"No relevant content found for query: {request.question[:100]}")
            used_tokens = 0
            if doc_id and doc_id > 0:
                try: used_tokens = tokens_stage1
                except NameError: pass
            else:
                try: used_tokens = total_stage1_tokens
                except NameError: pass
            return QueryResponse(
                question=request.question,
                answer="I cannot find this in the provided documents.",
                tokens_used=used_tokens,
                cost=0.0,
                cached=False,
                num_documents_queried=num_docs
            )

        # Stage 2: Answer generation (PageIndex approach)
        answer, citations, tokens_stage2 = await stage2_answer_generation(
            question=request.question,
            node_list=node_list,
            node_map=node_map,
            api_key=api_key,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            citation_style=citation_style if request.include_citations else "none",
            doc_results=doc_results
        )

        total_tokens = tokens_stage1 + tokens_stage2
        cost = calculate_cost(total_tokens, model)

        result = QueryResponse(
            question=request.question,
            answer=answer,
            citations=citations if request.include_citations else [],
            tokens_used=total_tokens,
            cost=cost,
            cached=False,
            relevant_nodes=node_list,
            thinking=thinking,
            num_documents_queried=num_docs
        )

        # Cache the result
        if request.use_cache:
            cache_ttl = query_settings.get("cache_ttl_hours", 24) * 3600
            await store_in_cache(cache_key, result.model_dump(), ttl=cache_ttl)

        logger.info(f"Query completed: {total_tokens} tokens, ${cost} ({num_docs} document(s))")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Query processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Query processing failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)
