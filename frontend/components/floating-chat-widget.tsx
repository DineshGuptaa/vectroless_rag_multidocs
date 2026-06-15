'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, X, Send, Bot, User, ChevronDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { queryApi } from '@/lib/api'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface FloatingChatWidgetProps {
  title?: string
  subtitle?: string
  welcomeMessage?: string
  suggestedQuestions?: string[]
  placeholder?: string
  footerText?: string
  onQuery?: (question: string) => Promise<string>
  primaryColor?: string
  buttonPosition?: 'bottom-right' | 'bottom-left'
  botAvatar?: ReactNode
  userAvatar?: ReactNode
  showNotificationBadge?: boolean
  notificationCount?: number
  documentId?: number
}

const defaultProps: Required<Omit<FloatingChatWidgetProps, 'onQuery' | 'botAvatar' | 'userAvatar' | 'documentId'>> = {
  title: 'Assistant',
  subtitle: 'Online',
  welcomeMessage: 'Hello! How can I help you today?',
  suggestedQuestions: [],
  placeholder: 'Ask a question...',
  footerText: 'Responses are for guidance only.',
  primaryColor: '#1e40af',
  buttonPosition: 'bottom-right',
  showNotificationBadge: false,
  notificationCount: 1,
}

export function FloatingChatWidget(props: FloatingChatWidgetProps) {
  const {
    title = defaultProps.title,
    subtitle = defaultProps.subtitle,
    welcomeMessage = defaultProps.welcomeMessage,
    suggestedQuestions = defaultProps.suggestedQuestions,
    placeholder = defaultProps.placeholder,
    footerText = defaultProps.footerText,
    onQuery: onQueryProp,
    primaryColor = defaultProps.primaryColor,
    buttonPosition = defaultProps.buttonPosition,
    botAvatar,
    userAvatar,
    showNotificationBadge = defaultProps.showNotificationBadge,
    notificationCount = defaultProps.notificationCount,
    documentId,
  } = props

  const greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'how are you', 'what\'s up', 'sup', 'yo']

  const defaultQueryHandler = async (question: string): Promise<string> => {
    const q = question.toLowerCase().trim()
    if (greetings.some(g => q === g || q.startsWith(g + ' '))) {
      return 'Hello! How can I help you today?'
    }
    const res = await queryApi.query({
      question,
      document_id: documentId,
      use_cache: true,
      include_citations: true,
    })
    return res.answer
  }

  const onQuery = onQueryProp || defaultQueryHandler

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: welcomeMessage, timestamp: new Date() },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isRight = buttonPosition === 'bottom-right'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  const handleSend = async (text?: string) => {
    const question = (text || input).trim()
    if (!question || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: question,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setShowSuggestions(false)

    try {
      let answer: string

      if (onQuery) {
        answer = await onQuery(question)
      } else {
        answer = 'No query handler configured. Pass an `onQuery` callback to process questions.'
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: answer,
        timestamp: new Date(),
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'An error occurred. Please try again.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const fabPositionClass = isRight ? 'right-6' : 'left-6'
  const panelPositionClass = isRight ? 'right-6' : 'left-6'

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 ${fabPositionClass} z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95`}
        style={{ backgroundColor: primaryColor }}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? (
          <X size={24} />
        ) : (
          <div className="relative">
            <MessageCircle size={24} />
            {showNotificationBadge && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {notificationCount}
              </span>
            )}
          </div>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={`fixed bottom-24 ${panelPositionClass} z-50 flex w-[380px] flex-col overflow-hidden rounded-2xl border shadow-2xl`}
            style={{ borderColor: `${primaryColor}20`, backgroundColor: 'white', height: '600px', maxHeight: 'calc(100vh - 140px)' }}
          >
            <div
              className="flex items-center gap-3 px-5 py-4 text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: `${primaryColor}cc` }}
              >
                {botAvatar || <Bot size={20} />}
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="text-[11px]" style={{ color: `${primaryColor}99` }}>{subtitle}</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:text-white"
                style={{ backgroundColor: `${primaryColor}cc`, color: `${primaryColor}22` }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {messages.map(message => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${primaryColor}15` }}
                    >
                      <div style={{ color: primaryColor }}>{botAvatar || <Bot size={14} />}</div>
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'rounded-tr-md text-white'
                        : 'rounded-tl-md border text-gray-700'
                    }`}
                    style={
                      message.role === 'user'
                        ? { backgroundColor: primaryColor }
                        : { borderColor: `${primaryColor}10`, backgroundColor: `${primaryColor}05` }
                    }
                  >
                    {message.role === 'assistant' ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      message.content
                    )}
                  </div>
                  {message.role === 'user' && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${primaryColor}20` }}
                    >
                      <div style={{ color: primaryColor }}>{userAvatar || <User size={14} />}</div>
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <div style={{ color: primaryColor }}>{botAvatar || <Bot size={14} />}</div>
                  </div>
                  <div className="rounded-2xl rounded-tl-md border px-4 py-3"
                    style={{ borderColor: `${primaryColor}10`, backgroundColor: `${primaryColor}05` }}
                  >
                    <div className="flex gap-1.5">
                      <span className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.6, animationDelay: '0ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.6, animationDelay: '150ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.6, animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {showSuggestions && suggestedQuestions.length > 0 && messages.length <= 1 && (
              <div className="border-t px-4 py-3" style={{ borderColor: `${primaryColor}10`, backgroundColor: `${primaryColor}02` }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <ChevronDown size={12} style={{ color: primaryColor }} />
                  <span className="text-[11px] font-medium" style={{ color: primaryColor }}>Suggested questions</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedQuestions.map(q => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      className="rounded-full border bg-white px-3 py-1.5 text-xs transition-colors hover:opacity-80"
                      style={{ borderColor: `${primaryColor}30`, color: primaryColor }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t p-3 bg-white" style={{ borderColor: `${primaryColor}10` }}>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  disabled={isLoading}
                  className="flex-1 rounded-xl border px-4 py-2.5 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 disabled:opacity-50"
                  style={{ borderColor: `${primaryColor}20`, backgroundColor: `${primaryColor}05` }}
                  onFocus={e => { e.target.style.borderColor = primaryColor }}
                  onBlur={e => { e.target.style.borderColor = `${primaryColor}20` }}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isLoading}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Send size={16} />
                </button>
              </div>
              {footerText && (
                <p className="mt-1.5 text-[10px] text-gray-400 text-center">{footerText}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
