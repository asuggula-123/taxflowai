import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DocumentList, Document } from "@/components/DocumentList";
import { CustomerDetailsPanel, CustomerDetailItem } from "@/components/CustomerDetailsPanel";
import { ChatInterface, ChatMessage } from "@/components/ChatInterface";
import { ArrowLeft } from "lucide-react";

export default function CustomerDetail() {
  const [, params] = useRoute("/customer/:id");
  const [, setLocation] = useLocation();

  //todo: remove mock functionality
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "ai",
      content: "Hello! I'll help you gather the necessary documents for this tax return. Let's start with last year's tax return. Please upload the 2023 tax return.",
      timestamp: new Date(Date.now() - 300000),
    },
  ]);

  const [documents, setDocuments] = useState<Document[]>([
    { id: "1", name: "2023_tax_return.pdf", status: "requested" },
  ]);

  const [details, setDetails] = useState<CustomerDetailItem[]>([
    { label: "Full Name", value: "John Smith", category: "Personal Info" },
    { label: "Email", value: "john.smith@email.com", category: "Personal Info" },
    { label: "SSN", value: null, category: "Personal Info" },
    { label: "Filing Status", value: null, category: "Personal Info" },
    { label: "W2 Income", value: null, category: "Income Sources" },
    { label: "1099 Income", value: null, category: "Income Sources" },
    { label: "Mortgage Interest", value: null, category: "Deductions" },
  ]);

  const handleSendMessage = (message: string) => {
    const newMessage: ChatMessage = {
      id: String(Date.now()),
      sender: "accountant",
      content: message,
      timestamp: new Date(),
    };
    setMessages([...messages, newMessage]);

    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: String(Date.now() + 1),
        sender: "ai",
        content: "I've noted that information. Please continue uploading the required documents.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 1000);
  };

  const handleFileUpload = (files: FileList) => {
    const fileNames = Array.from(files).map((f) => f.name);
    
    fileNames.forEach((name) => {
      const newDoc: Document = {
        id: String(Date.now() + Math.random()),
        name,
        status: "completed",
      };
      setDocuments((prev) => [...prev, newDoc]);
    });

    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: String(Date.now()),
        sender: "ai",
        content: `I've received ${fileNames.length} document(s). Analyzing now...`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/")}
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold truncate">John Smith</h1>
              <p className="text-xs text-muted-foreground">john.smith@email.com</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="grid md:grid-cols-2 gap-4 p-4">
          <div className="space-y-4">
            <DocumentList documents={documents} />
          </div>
          <div className="space-y-4">
            <CustomerDetailsPanel details={details} />
          </div>
        </div>

        <div className="flex-1 min-h-[400px]">
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            onFileUpload={handleFileUpload}
          />
        </div>
      </div>
    </div>
  );
}
