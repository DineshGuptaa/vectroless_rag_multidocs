(function () {
  'use strict'

  var CONFIG = {
    apiUrl: 'http://localhost:8000',
    title: 'Assistant',
    subtitle: 'Online',
    welcomeMessage: 'Hello! How can I help you today?',
    placeholder: 'Ask a question...',
    footerText: 'Answers are AI-generated. Verify critical info from source documents.',
    primaryColor: '#1e40af',
    documentId: null,
    suggestedQuestions: [],
  }

  var scriptTag = document.currentScript
  if (scriptTag) {
    if (scriptTag.getAttribute('data-api-url')) CONFIG.apiUrl = scriptTag.getAttribute('data-api-url')
    if (scriptTag.getAttribute('data-title')) CONFIG.title = scriptTag.getAttribute('data-title')
    if (scriptTag.getAttribute('data-subtitle')) CONFIG.subtitle = scriptTag.getAttribute('data-subtitle')
    if (scriptTag.getAttribute('data-welcome')) CONFIG.welcomeMessage = scriptTag.getAttribute('data-welcome')
    if (scriptTag.getAttribute('data-placeholder')) CONFIG.placeholder = scriptTag.getAttribute('data-placeholder')
    if (scriptTag.getAttribute('data-color')) CONFIG.primaryColor = scriptTag.getAttribute('data-color')
    if (scriptTag.getAttribute('data-document-id')) CONFIG.documentId = parseInt(scriptTag.getAttribute('data-document-id'), 10)
    if (scriptTag.getAttribute('data-questions')) {
      try { CONFIG.suggestedQuestions = JSON.parse(scriptTag.getAttribute('data-questions')) } catch (e) {}
    }
  }

  var STATE = {
    isOpen: false,
    messages: [
      { id: 'welcome', role: 'assistant', content: CONFIG.welcomeMessage }
    ],
    isLoading: false,
    inputText: '',
  }

  var rootEl, shadow, fab, panel, messagesContainer, inputEl

  function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? parseInt(result[1], 16) + ', ' + parseInt(result[2], 16) + ', ' + parseInt(result[3], 16)
      : '30, 64, 175'
  }

  var rgb = hexToRgb(CONFIG.primaryColor)

  var style = document.createElement('style')
  style.textContent = [
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    '.asha-fab {',
      'position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;',
      'width: 56px; height: 56px; border-radius: 50%; border: none;',
      'background: ' + CONFIG.primaryColor + '; color: #fff;',
      'box-shadow: 0 4px 20px rgba(' + rgb + ', 0.4);',
      'cursor: pointer; display: flex; align-items: center; justify-content: center;',
      'transition: all 0.2s ease;',
    '}',
    '.asha-fab:hover { transform: scale(1.08); }',
    '.asha-fab:active { transform: scale(0.95); }',
    '.asha-fab .icon-open, .asha-fab .icon-close {',
      'width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;',
    '}',
    '.asha-fab .icon-close { display: none; }',
    '.asha-fab.open .icon-open { display: none; }',
    '.asha-fab.open .icon-close { display: flex; }',
    '.asha-badge {',
      'position: absolute; top: -4px; right: -4px;',
      'width: 16px; height: 16px; border-radius: 50%;',
      'background: #ef4444; color: #fff;',
      'font-size: 10px; font-weight: 700; display: flex;',
      'align-items: center; justify-content: center;',
    '}',
    '.asha-panel {',
      'position: fixed; bottom: 96px; right: 24px; z-index: 2147483646;',
      'width: 380px; height: 600px; max-height: calc(100vh - 140px);',
      'background: #fff; border-radius: 16px;',
      'border: 1px solid rgba(' + rgb + ', 0.12);',
      'box-shadow: 0 16px 48px rgba(0,0,0,0.15);',
      'display: flex; flex-direction: column; overflow: hidden;',
      'animation: ashaSlideUp 0.25s ease-out;',
    '}',
    '@keyframes ashaSlideUp {',
      'from { opacity: 0; transform: translateY(20px) scale(0.96); }',
      'to { opacity: 1; transform: translateY(0) scale(1); }',
    '}',
    '@keyframes ashaFadeIn {',
      'from { opacity: 0; transform: translateY(10px); }',
      'to { opacity: 1; transform: translateY(0); }',
    '}',
    '.asha-header {',
      'display: flex; align-items: center; gap: 12px;',
      'padding: 16px 20px; background: ' + CONFIG.primaryColor + '; color: #fff;',
    '}',
    '.asha-avatar {',
      'width: 36px; height: 36px; border-radius: 50%; display: flex;',
      'align-items: center; justify-content: center;',
      'background: rgba(255,255,255,0.2); font-size: 18px;',
    '}',
    '.asha-header-info { flex: 1; }',
    '.asha-header-info h2 { font-size: 14px; font-weight: 600; }',
    '.asha-header-info p { font-size: 11px; opacity: 0.7; }',
    '.asha-close-btn {',
      'width: 28px; height: 28px; border-radius: 50%; border: none;',
      'background: rgba(255,255,255,0.2); color: #fff;',
      'cursor: pointer; display: flex; align-items: center; justify-content: center;',
      'transition: background 0.15s;',
    '}',
    '.asha-close-btn:hover { background: rgba(255,255,255,0.35); }',
    '.asha-messages {',
      'flex: 1; overflow-y: auto; padding: 16px;',
      'scrollbar-width: thin;',
    '}',
    '.asha-msg { display: flex; gap: 12px; margin-bottom: 16px; animation: ashaFadeIn 0.25s ease-out; }',
    '.asha-msg.justify-end { justify-content: flex-end; }',
    '.asha-msg-avatar {',
      'width: 28px; height: 28px; border-radius: 50%; display: flex;',
      'align-items: center; justify-content: center; flex-shrink: 0;',
      'font-size: 14px;',
    '}',
    '.asha-msg-bubble {',
      'max-width: 85%; border-radius: 16px; padding: 10px 16px;',
      'font-size: 14px; line-height: 1.6;',
    '}',
    '.asha-msg-bubble.user {',
      'background: ' + CONFIG.primaryColor + '; color: #fff;',
      'border-bottom-right-radius: 4px;',
    '}',
    '.asha-msg-bubble.assistant {',
      'background: rgba(' + rgb + ', 0.04);',
      'border: 1px solid rgba(' + rgb + ', 0.08);',
      'color: #374151; border-bottom-left-radius: 4px;',
    '}',
    '.asha-msg-bubble p { margin-bottom: 8px; }',
    '.asha-msg-bubble p:last-child { margin-bottom: 0; }',
    '.asha-msg-bubble ul, .asha-msg-bubble ol { padding-left: 20px; margin-bottom: 8px; }',
    '.asha-msg-bubble li { margin-bottom: 4px; }',
    '.asha-msg-bubble code {',
      'background: rgba(' + rgb + ', 0.1); padding: 2px 6px;',
      'border-radius: 4px; font-size: 13px; font-family: monospace;',
    '}',
    '.asha-msg-bubble pre {',
      'background: #1e293b; color: #e2e8f0; padding: 12px;',
      'border-radius: 8px; overflow-x: auto; margin: 8px 0;',
      'font-size: 13px; font-family: monospace;',
    '}',
    '.asha-msg-bubble pre code { background: none; padding: 0; }',
    '.asha-msg-bubble table {',
      'border-collapse: collapse; width: 100%; margin: 8px 0;',
      'font-size: 13px;',
    '}',
    '.asha-msg-bubble th, .asha-msg-bubble td {',
      'border: 1px solid rgba(' + rgb + ', 0.2);',
      'padding: 6px 10px; text-align: left;',
    '}',
    '.asha-msg-bubble th { background: rgba(' + rgb + ', 0.08); font-weight: 600; }',
    '.asha-msg-bubble blockquote {',
      'border-left: 3px solid ' + CONFIG.primaryColor + ';',
      'padding-left: 12px; margin: 8px 0; color: #6b7280; font-style: italic;',
    '}',
    '.asha-loading {',
      'display: flex; gap: 6px; padding: 16px 20px;',
      'background: rgba(' + rgb + ', 0.04); border-radius: 16px;',
      'border: 1px solid rgba(' + rgb + ', 0.08); align-items: center;',
    '}',
    '.asha-dot {',
      'width: 8px; height: 8px; border-radius: 50%;',
      'background: ' + CONFIG.primaryColor + '; opacity: 0.5;',
      'animation: ashaBounce 1.2s infinite;',
    '}',
    '.asha-dot:nth-child(2) { animation-delay: 0.15s; }',
    '.asha-dot:nth-child(3) { animation-delay: 0.3s; }',
    '@keyframes ashaBounce {',
      '0%, 80%, 100% { transform: translateY(0); }',
      '40% { transform: translateY(-8px); }',
    '}',
    '.asha-suggestions {',
      'border-top: 1px solid rgba(' + rgb + ', 0.08);',
      'padding: 12px 16px;',
      'background: rgba(' + rgb + ', 0.02);',
    '}',
    '.asha-suggestions-header {',
      'display: flex; align-items: center; gap: 6px; margin-bottom: 6px;',
      'font-size: 11px; font-weight: 500; color: ' + CONFIG.primaryColor + ';',
    '}',
    '.asha-suggestions-list { display: flex; flex-wrap: wrap; gap: 4px; }',
    '.asha-chip {',
      'border-radius: 999px; border: 1px solid rgba(' + rgb + ', 0.2);',
      'background: #fff; padding: 5px 12px; font-size: 12px;',
      'cursor: pointer; color: ' + CONFIG.primaryColor + ';',
      'transition: background 0.15s;',
    '}',
    '.asha-chip:hover { background: rgba(' + rgb + ', 0.06); }',
    '.asha-input-area {',
      'border-top: 1px solid rgba(' + rgb + ', 0.08);',
      'padding: 12px 16px; background: #fff;',
    '}',
    '.asha-input-row { display: flex; gap: 8px; }',
    '.asha-input {',
      'flex: 1; border-radius: 12px; border: 1px solid rgba(' + rgb + ', 0.15);',
      'padding: 10px 14px; font-size: 14px; outline: none;',
      'background: rgba(' + rgb + ', 0.03);',
      'transition: border-color 0.15s;',
    '}',
    '.asha-input:focus { border-color: ' + CONFIG.primaryColor + '; }',
    '.asha-input::placeholder { color: #9ca3af; }',
    '.asha-send-btn {',
      'width: 40px; height: 40px; border-radius: 12px; border: none;',
      'background: ' + CONFIG.primaryColor + '; color: #fff;',
      'cursor: pointer; display: flex; align-items: center; justify-content: center;',
      'transition: opacity 0.15s; flex-shrink: 0;',
    '}',
    '.asha-send-btn:disabled { opacity: 0.4; cursor: default; }',
    '.asha-send-btn:not(:disabled):hover { opacity: 0.9; }',
    '.asha-footer {',
      'text-align: center; margin-top: 6px;',
      'font-size: 10px; color: #9ca3af;',
    '}',
    '.asha-hidden { display: none !important; }',
  ].join('\n')

  function createSVG(html) {
    var div = document.createElement('div')
    div.innerHTML = html
    return div.firstElementChild
  }

  var chatIcon = createSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>')
  var closeIcon = createSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>')
  var botIcon = createSVG('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>')
  var userIcon = createSVG('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>')
  var sendIcon = createSVG('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>')
  var chevronIcon = createSVG('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>')

  function escapeHtml(text) {
    var d = document.createElement('div')
    d.textContent = text
    return d.innerHTML
  }

  function simpleMarkdown(text) {
    var html = escapeHtml(text)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
    html = html.replace(/### (.+)/g, '<h3>$1</h3>')
    html = html.replace(/## (.+)/g, '<h2>$1</h2>')
    html = html.replace(/# (.+)/g, '<h1>$1</h1>')
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
    html = html.replace(/^- (.+)/gm, '<li>$1</li>')
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    html = html.replace(/\|(.+)\|/g, function (m) {
      var cells = m.slice(1, -1).split('|').map(function (c) { return c.trim() })
      if (/^[-:]+$/.test(cells.join(''))) return ''
      return '<tr><td>' + cells.join('</td><td>') + '</td></tr>'
    })
    html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')
    html = html.replace(/^> (.+)/gm, '<blockquote>$1</blockquote>')
    html = html.replace(/\n\n/g, '</p><p>')
    html = '<p>' + html + '</p>'
    html = html.replace(/<p><\/p>/g, '')
    html = html.replace(/<li><\/li>/g, '')
    html = html.replace(/<ul>\s*<\/ul>/g, '')
    return html
  }

  function renderMessages() {
    var html = ''

    STATE.messages.forEach(function (msg) {
      var isUser = msg.role === 'user'
      html += '<div class="asha-msg' + (isUser ? ' justify-end' : '') + '">'

      if (!isUser) {
        html += '<div class="asha-msg-avatar" style="background: rgba(' + rgb + ', 0.1); color: ' + CONFIG.primaryColor + '">' + botIcon.outerHTML + '</div>'
      }

      html += '<div class="asha-msg-bubble ' + (isUser ? 'user' : 'assistant') + '">'

      if (isUser) {
        html += '<p>' + escapeHtml(msg.content) + '</p>'
      } else {
        html += simpleMarkdown(msg.content)
      }

      html += '</div>'

      if (isUser) {
        html += '<div class="asha-msg-avatar" style="background: rgba(' + rgb + ', 0.15); color: ' + CONFIG.primaryColor + '">' + userIcon.outerHTML + '</div>'
      }

      html += '</div>'
    })

    if (STATE.isLoading) {
      html += '<div class="asha-msg"><div class="asha-msg-avatar" style="background: rgba(' + rgb + ', 0.1); color: ' + CONFIG.primaryColor + '">' + botIcon.outerHTML + '</div>'
      html += '<div class="asha-loading"><div class="asha-dot"></div><div class="asha-dot"></div><div class="asha-dot"></div></div></div>'
    }

    messagesContainer.innerHTML = html
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }

  var greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'how are you', "what's up", 'sup', 'yo']

  function sendMessage(text) {
    var question = (text || STATE.inputText).trim()
    if (!question || STATE.isLoading) return

    STATE.messages.push({ id: 'm' + Date.now(), role: 'user', content: question })
    STATE.inputText = ''
    inputEl.value = ''
    STATE.isLoading = true
    updateSendButton()

    var ql = question.toLowerCase().trim()
    if (greetings.some(function (g) { return ql === g || ql.indexOf(g + ' ') === 0 })) {
      STATE.messages.push({ id: 'm' + Date.now(), role: 'assistant', content: 'Hello! How can I help you today?' })
      STATE.isLoading = false
      renderMessages()
      updateSendButton()
      return
    }

    renderMessages()

    var url = CONFIG.apiUrl + '/api/query'
    var body = JSON.stringify({
      question: question,
      document_id: CONFIG.documentId || undefined,
      use_cache: true,
      include_citations: true,
    })

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status)
        return res.json()
      })
      .then(function (data) {
        STATE.messages.push({ id: 'm' + Date.now(), role: 'assistant', content: data.answer || 'No answer received.' })
        STATE.isLoading = false
        renderMessages()
        updateSendButton()
      })
      .catch(function (err) {
        STATE.messages.push({ id: 'm' + Date.now(), role: 'assistant', content: 'Error: ' + err.message })
        STATE.isLoading = false
        renderMessages()
        updateSendButton()
      })
  }

  function updateSendButton() {
    var btn = shadow.querySelector('.asha-send-btn')
    if (btn) {
      btn.disabled = !STATE.inputText.trim() || STATE.isLoading
    }
  }

  function buildWidget() {
    rootEl = document.createElement('div')
    rootEl.id = 'asha-chat-widget'

    shadow = rootEl.attachShadow({ mode: 'open' })
    shadow.appendChild(style)

    fab = document.createElement('button')
    fab.className = 'asha-fab'
    fab.innerHTML = '<span class="icon-open">' + chatIcon.outerHTML + '<span class="asha-badge">1</span></span><span class="icon-close">' + closeIcon.outerHTML + '</span>'
    fab.addEventListener('click', togglePanel)
    shadow.appendChild(fab)

    panel = document.createElement('div')
    panel.className = 'asha-panel asha-hidden'

    panel.innerHTML = [
      '<div class="asha-header">',
        '<div class="asha-avatar">' + botIcon.outerHTML.replace('width="14"', 'width="18"').replace('height="14"', 'height="18"') + '</div>',
        '<div class="asha-header-info"><h2>' + escapeHtml(CONFIG.title) + '</h2><p>' + escapeHtml(CONFIG.subtitle) + '</p></div>',
        '<button class="asha-close-btn">' + closeIcon.outerHTML.replace('width="24"', 'width="14"').replace('height="24"', 'height="14"').replace('stroke-width="2"', 'stroke-width="2.5"') + '</button>',
      '</div>',
      '<div class="asha-messages"></div>',
      CONFIG.suggestedQuestions.length
        ? '<div class="asha-suggestions asha-suggestions-wrap"><div class="asha-suggestions-header">' + chevronIcon.outerHTML + '<span>Suggested questions</span></div><div class="asha-suggestions-list">' + CONFIG.suggestedQuestions.map(function (q) { return '<button class="asha-chip">' + escapeHtml(q) + '</button>' }).join('') + '</div></div>'
        : '',
      '<div class="asha-input-area">',
        '<div class="asha-input-row">',
          '<input class="asha-input" type="text" placeholder="' + escapeHtml(CONFIG.placeholder) + '" />',
          '<button class="asha-send-btn" disabled>' + sendIcon.outerHTML + '</button>',
        '</div>',
        '<div class="asha-footer">' + escapeHtml(CONFIG.footerText) + '</div>',
      '</div>',
    ].join('\n')

    shadow.appendChild(panel)

    document.body.appendChild(rootEl)

    messagesContainer = shadow.querySelector('.asha-messages')
    inputEl = shadow.querySelector('.asha-input')
    var sendBtn = shadow.querySelector('.asha-send-btn')
    var closeBtn = shadow.querySelector('.asha-close-btn')
    var suggestionsWrap = shadow.querySelector('.asha-suggestions-wrap')

    inputEl.addEventListener('input', function () {
      STATE.inputText = inputEl.value
      updateSendButton()
    })

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    })

    sendBtn.addEventListener('click', function () { sendMessage() })
    closeBtn.addEventListener('click', togglePanel)

    if (suggestionsWrap) {
      suggestionsWrap.querySelectorAll('.asha-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          sendMessage(chip.textContent)
        })
      })
    }

    renderMessages()
  }

  function togglePanel() {
    STATE.isOpen = !STATE.isOpen
    fab.classList.toggle('open', STATE.isOpen)
    panel.classList.toggle('asha-hidden', !STATE.isOpen)

    if (STATE.isOpen) {
      setTimeout(function () { if (inputEl) inputEl.focus() }, 300)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget)
  } else {
    buildWidget()
  }
})()
