import { useState } from 'react';
import { ChatInterface, ChatMessage } from '../ChatInterface';

export default function ChatInterfaceExample() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ai',
      content: "Hello! I'll help you gather the necessary documents for this tax return. Let's start with last year's tax return. Do you have the 2023 tax return available?",
      timestamp: new Date(Date.now() - 120000),
    },
    {
      id: '2',
      sender: 'accountant',
      content: "Yes, I'm uploading it now.",
      timestamp: new Date(Date.now() - 60000),
    },
  ]);

  const handleSendMessage = (message: string) => {
    const newMessage: ChatMessage = {
      id: String(Date.now()),
      sender: 'accountant',
      content: message,
      timestamp: new Date(),
    };
    setMessages([...messages, newMessage]);
  };

  const handleFileUpload = (files: FileList) => {
    console.log('Files uploaded:', Array.from(files).map(f => f.name));
  };

  return (
    <div className="h-[600px] max-w-4xl mx-auto p-8">
      <ChatInterface
        messages={messages}
        onSendMessage={handleSendMessage}
        onFileUpload={handleFileUpload}
      />
    </div>
  );
}
