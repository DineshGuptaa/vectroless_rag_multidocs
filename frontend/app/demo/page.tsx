'use client'

import { FloatingChatWidget } from '@/components/floating-chat-widget'

export default function DemoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-gray-700">Demo</h1>
        <p className="mt-2 text-sm text-gray-400">Click the chat bubble to test the assistant.</p>
      </div>
      <FloatingChatWidget />
    </div>
  )
}
