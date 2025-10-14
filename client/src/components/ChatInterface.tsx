import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Send, FileText, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ProgressSteps, type ProgressStep } from "./ProgressSteps";
import { MemoryConfirmation } from "./MemoryConfirmation";

export interface DetectedMemory {
  type: 'firm' | 'customer';
  content: string;
  reason: string;
}

export interface ChatMessage {
  id: string;
  sender: "accountant" | "ai";
  content: string;
  timestamp: Date;
  detectedMemories?: DetectedMemory[];
}

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage?: (message: string) => void;
  onFileUpload?: (files: FileList) => void;
  isUploading?: boolean;
  isAiThinking?: boolean;
  customerStatus?: "Awaiting Tax Return" | "Incomplete" | "Ready";
  progressStep?: ProgressStep | null;
  progressMessage?: string;
  progressValue?: number;
  customerId?: string;
  intakeYear?: string;
  onConfirmMemory?: (messageId: string, memory: DetectedMemory) => void;
  onDismissMemory?: (messageId: string, memoryIndex: number) => void;
  isConfirmingMemory?: boolean;
}

export function ChatInterface({
  messages,
  onSendMessage,
  onFileUpload,
  isUploading = false,
  isAiThinking = false,
  customerStatus,
  progressStep = null,
  progressMessage = "",
  progressValue = 0,
  customerId,
  intakeYear,
  onConfirmMemory,
  onDismissMemory,
  isConfirmingMemory = false,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isChatDisabled = customerStatus === "Awaiting Tax Return";
  
  const priorYear = intakeYear ? String(parseInt(intakeYear) - 1) : "2023";

  const handleSend = () => {
    if (input.trim() && !isChatDisabled) {
      onSendMessage?.(input);
      setInput("");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      onFileUpload?.(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full border-t">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className="space-y-2">
              <div
                className={`flex ${message.sender === "accountant" ? "justify-end" : "justify-start"}`}
                data-testid={`message-${message.id}`}
              >
                <div
                  className={`max-w-[80%] space-y-1 ${
                    message.sender === "accountant" ? "items-end" : "items-start"
                  } flex flex-col`}
                >
                  <Card
                    className={`p-3 ${
                      message.sender === "accountant"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card"
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                  </Card>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(message.timestamp)}
                  </span>
                </div>
              </div>
              {message.sender === "ai" && message.detectedMemories && message.detectedMemories.length > 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[80%]">
                    <MemoryConfirmation
                      memories={message.detectedMemories}
                      customerId={customerId || null}
                      onConfirm={(memory) => onConfirmMemory?.(message.id, memory)}
                      onDismiss={(index) => onDismissMemory?.(message.id, index)}
                      isPending={isConfirmingMemory}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
          {isAiThinking && (
            <div className="flex justify-start" data-testid="ai-thinking-indicator">
              <div className="max-w-[80%] space-y-1 items-start flex flex-col">
                <Card className="p-3 bg-card">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">AI is thinking...</p>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t space-y-3">
        <div
          className={`border-2 border-dashed rounded-md p-6 text-center transition-colors ${
            isUploading
              ? "border-primary bg-primary/10 pointer-events-none"
              : isDragging
              ? "border-primary bg-primary/5"
              : "border-border"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          data-testid="dropzone-documents"
        >
          {isUploading && progressStep ? (
            <ProgressSteps
              currentStep={progressStep}
              message={progressMessage}
              progress={progressValue}
            />
          ) : isUploading ? (
            <>
              <FileText className="h-8 w-8 mx-auto mb-2 text-primary" />
              <p className="text-sm text-primary font-medium">
                Uploading and analyzing documents...
              </p>
            </>
          ) : (
            <>
              <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                Drop documents here or{" "}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-primary hover:underline"
                  data-testid="button-browse-files"
                >
                  browse
                </button>
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                onFileUpload?.(e.target.files);
              }
            }}
            data-testid="input-file-upload"
            disabled={isUploading}
          />
        </div>

        {isChatDisabled ? (
          <div className="p-4 border-2 border-dashed rounded-md bg-muted/30" data-testid="chat-disabled-message">
            <p className="text-sm text-muted-foreground text-center">
              Chat is disabled until you upload and validate the customer's {priorYear} tax return.
            </p>
          </div>
        ) : (
          <div className="flex gap-2">
            <Textarea
              placeholder="Add customer details or ask a question..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="resize-none min-h-[60px]"
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSend}
              size="icon"
              disabled={!input.trim()}
              data-testid="button-send-message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
