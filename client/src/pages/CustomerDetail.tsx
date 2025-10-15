import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DocumentList } from "@/components/DocumentList";
import { CustomerDetailsPanel } from "@/components/CustomerDetailsPanel";
import { ChatInterface, type DetectedMemory } from "@/components/ChatInterface";
import { ArrowLeft } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useProgressWebSocket } from "@/hooks/use-progress-websocket";
import type { Customer } from "@/components/CustomerList";
import type { Document } from "@/components/DocumentList";
import type { CustomerDetailItem } from "@/components/CustomerDetailsPanel";
import type { ChatMessage } from "@/components/ChatInterface";
import type { TaxYearIntake } from "@shared/schema";

export default function CustomerDetail() {
  const [, params] = useRoute("/customers/:id/intakes/:year");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const customerId = params?.id || "";
  const year = params?.year || "";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Track detected memories for each message - keyed by message ID
  const [messageMemories, setMessageMemories] = useState<Record<string, DetectedMemory[]>>({});
  
  // Track currently streaming message for immediate visual updates
  const [streamingMessage, setStreamingMessage] = useState<{id: string; content: string} | null>(null);
  
  // Fetch the intake to get intakeId
  const { data: intake, isLoading: isLoadingIntake, isError: isIntakeError } = useQuery<TaxYearIntake | undefined>({
    queryKey: ["/api/intakes", customerId, year],
    queryFn: async () => {
      const intakes = await fetch(`/api/customers/${customerId}/intakes`).then(r => r.json());
      const foundIntake = intakes.find((i: TaxYearIntake) => String(i.year) === String(year));
      if (!foundIntake) {
        console.error(`No intake found for year ${year}. Available intakes:`, intakes.map((i: TaxYearIntake) => i.year));
      }
      return foundIntake;
    },
    enabled: !!customerId && !!year,
  });
  
  const intakeId = intake?.id || "";
  
  // WebSocket for progress tracking - use customerId from intake
  const { currentStep, message: progressMessage, progress: progressValue } = useProgressWebSocket(intake?.customerId || "");

  // Fetch customer for display
  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    queryFn: async () => {
      const response = await fetch(`/api/customers/${customerId}`);
      if (!response.ok) throw new Error("Customer not found");
      return response.json();
    },
    enabled: !!customerId,
  });

  // Fetch documents using intakeId
  const { data: documents = [] } = useQuery<Document[]>({
    queryKey: ["/api/intakes", intakeId, "documents"],
    queryFn: async () => {
      const response = await fetch(`/api/intakes/${intakeId}/documents`);
      return response.json();
    },
    enabled: !!intakeId,
  });

  // Fetch messages using intakeId
  const { data: rawMessages = [] } = useQuery<ChatMessage[]>({
    queryKey: ["/api/intakes", intakeId, "messages"],
    queryFn: async () => {
      const response = await fetch(`/api/intakes/${intakeId}/messages`);
      return response.json();
    },
    enabled: !!intakeId,
  });

  // Fetch details using intakeId
  const { data: details = [] } = useQuery<CustomerDetailItem[]>({
    queryKey: ["/api/intakes", intakeId, "details"],
    queryFn: async () => {
      const response = await fetch(`/api/intakes/${intakeId}/details`);
      return response.json();
    },
    enabled: !!intakeId,
  });

  // Include streaming message if present
  const allMessages = streamingMessage 
    ? [...rawMessages, {
        id: streamingMessage.id,
        intakeId,
        sender: "ai",
        content: streamingMessage.content,
        createdAt: new Date().toISOString(),
      }]
    : rawMessages;

  const messages = allMessages.map((m: any) => ({
    ...m,
    timestamp: new Date(m.createdAt || Date.now()),
    detectedMemories: messageMemories[m.id] || [],
  }));

  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, tempAccountantId }: { content: string; tempAccountantId: string }) => {
      // Use streaming endpoint, pass tempAccountantId so backend can return it for correlation
      const response = await fetch(`/api/intakes/${intakeId}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "accountant", content, tempAccountantId }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to send message");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let accountantMessage: any = null;
      let aiMessageId: string | null = null;
      let streamingContent = "";
      let finalResult: any = { aiMessage: null, detectedMemories: [] };
      let pendingMemories: any[] = []; // Store memories that arrive before first chunk

      // Read stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          
          if (line.startsWith("data:")) {
            const data = JSON.parse(line.slice(6));

            if (currentEvent === "accountant_message") {
              // Real accountant message saved - replace temp optimistic message immediately
              accountantMessage = data;
              
              // Replace specific temp accountant message with real persisted one
              // tempAccountantId is returned from backend for correlation
              if (data.tempAccountantId) {
                queryClient.setQueryData(
                  ["/api/intakes", intakeId, "messages"],
                  (old: any[] = []) => 
                    old.filter(msg => msg.id !== data.tempAccountantId)
                      .concat(accountantMessage)
                );
              }
            }

            if (currentEvent === "memories") {
              // Memories detected - show immediately (before streaming completes)
              const memories = data.detectedMemories || [];
              if (memories.length > 0) {
                if (aiMessageId) {
                  // AI message exists, attach memories immediately
                  setMessageMemories(prev => ({
                    ...prev,
                    [aiMessageId as string]: memories
                  }));
                } else {
                  // No AI message yet, store for later
                  pendingMemories = memories;
                }
              }
            }

            if (currentEvent === "chunk" && data.content) {
              // Streaming chunk
              streamingContent += data.content;
              
              // Create temp ID if needed
              if (!aiMessageId) {
                aiMessageId = `ai-temp-${Date.now()}`;
                
                // Apply pending memories if any
                if (pendingMemories.length > 0) {
                  setMessageMemories(prev => ({
                    ...prev,
                    [aiMessageId as string]: pendingMemories
                  }));
                  pendingMemories = [];
                }
              }
              
              // Update local state for immediate visual update (triggers re-render)
              setStreamingMessage({
                id: aiMessageId,
                content: streamingContent
              });
            }

            if (currentEvent === "complete") {
              // Stream complete
              const finalMessage = data.aiMessage;
              const detectedMemories = data.detectedMemories || [];
              const requestedDocuments = data.requestedDocuments || [];
              finalResult = { aiMessage: finalMessage, detectedMemories, requestedDocuments };

              // Clear streaming message state
              setStreamingMessage(null);

              // Show memories immediately
              if (detectedMemories.length > 0 && finalMessage?.id) {
                setMessageMemories(prev => ({
                  ...prev,
                  [finalMessage.id]: detectedMemories
                }));
              }

              // Auto-create requested documents
              if (requestedDocuments.length > 0) {
                console.log("AI requested documents:", requestedDocuments);
                // Create documents via API
                fetch(`/api/intakes/${intakeId}/documents/bulk-create`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ documents: requestedDocuments }),
                }).then(() => {
                  // Refresh documents list
                  queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "documents"] });
                }).catch(err => console.error("Failed to create documents:", err));
              }

              // Add real persisted message to cache
              // (temp accountant already replaced when accountant_message event arrived)
              queryClient.setQueryData(
                ["/api/intakes", intakeId, "messages"],
                (old: any[] = []) => [...old, finalMessage]
              );
            }
          }
        }
      }

      return finalResult;
    },
    onMutate: async ({ content, tempAccountantId }: { content: string; tempAccountantId: string }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/intakes", intakeId, "messages"] });

      // Optimistically add user's message using provided tempAccountantId
      const optimisticMessage = {
        id: tempAccountantId,
        intakeId,
        sender: "accountant" as const,
        content,
        createdAt: new Date().toISOString(),
      };

      queryClient.setQueryData(
        ["/api/intakes", intakeId, "messages"],
        (old: any[] = []) => [...old, optimisticMessage]
      );

      return { tempAccountantId };
    },
    onSuccess: (data: any) => {
      // Capture detected memories
      if (data?.detectedMemories && data?.aiMessage?.id) {
        setMessageMemories(prev => ({
          ...prev,
          [data.aiMessage.id]: data.detectedMemories
        }));
      }
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "details"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId] });
    },
    onError: (err, _variables, context) => {
      // Remove failed optimistic accountant message
      if (context?.tempAccountantId) {
        queryClient.setQueryData(
          ["/api/intakes", intakeId, "messages"],
          (old: any[] = []) => old.filter((msg) => msg.id !== context.tempAccountantId)
        );
      }
      
      toast({
        title: "Failed to send message",
        description: "Your message could not be sent. Please try again.",
        variant: "destructive",
      });
    },
  });

  const confirmMemoryMutation = useMutation({
    mutationFn: async ({ content, type }: { content: string; type: 'firm' | 'customer' }) => {
      // Step 1: Create the memory entity (for audit trail)
      await apiRequest("POST", "/api/memories", {
        type,
        customerId: type === 'customer' ? customerId : null,
        content,
      });

      // Step 2: Synthesize all memories into clean notes
      const synthesisResponse = await apiRequest("POST", "/api/memories/synthesize", {
        type,
        customerId: type === 'customer' ? customerId : null,
      });

      return synthesisResponse.json();
    },
    onSuccess: (data, variables) => {
      // Invalidate the appropriate query to refresh UI
      if (variables.type === 'firm') {
        queryClient.invalidateQueries({ queryKey: ["/api/firm/settings"] });
        toast({
          title: "Firm policy saved",
          description: "This policy has been added to your firm settings and will be used for all customers.",
        });
      } else if (variables.type === 'customer') {
        queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "notes"] });
        toast({
          title: "Customer note saved",
          description: "This information has been added to the customer's notes.",
        });
      }
    },
  });

  const uploadFilesMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(`/api/intakes/${intakeId}/documents/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        // Parse error message from server response
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed. Please check your document and try again.");
      }
      
      return response.json();
    },
    onMutate: () => {
      toast({
        title: "Uploading documents...",
        description: "Please wait while we upload and analyze your documents.",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "details"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", customerId, year] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Upload complete",
        description: "Documents uploaded and analyzed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload documents. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSendMessage = (message: string) => {
    // Generate tempAccountantId here so both onMutate and mutationFn can access it
    const tempAccountantId = `temp-accountant-${Date.now()}-${Math.random()}`;
    sendMessageMutation.mutate({ content: message, tempAccountantId });
  };

  const handleFileUpload = (files: FileList) => {
    uploadFilesMutation.mutate(files);
  };

  const handleConfirmMemory = (messageId: string, memory: DetectedMemory) => {
    confirmMemoryMutation.mutate(
      {
        content: memory.content,
        type: memory.type,
      },
      {
        onSuccess: () => {
          // Only remove the memory from UI after successful save
          setMessageMemories(prev => {
            const memories = prev[messageId] || [];
            return {
              ...prev,
              [messageId]: memories.filter(m => m.content !== memory.content)
            };
          });
          
          toast({
            title: "Memory saved",
            description: "This information will be remembered for future interactions.",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to save memory. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleDismissMemory = (messageId: string, memoryIndex: number) => {
    // Remove this memory from the message's detected memories
    setMessageMemories(prev => {
      const memories = prev[messageId] || [];
      return {
        ...prev,
        [messageId]: memories.filter((_, i) => i !== memoryIndex)
      };
    });
  };

  // Show loading while intake is being fetched
  if (isLoadingIntake) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Show error if intake not found
  if (isIntakeError || !intake) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">Intake not found for tax year {year}</p>
          <Button onClick={() => setLocation(`/customers/${customerId}`)} data-testid="button-back-to-summary">
            Back to Customer Summary
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation(`/customers/${customerId}`)}
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold truncate">{customer?.name || "Loading..."}</h1>
              <p className="text-xs text-muted-foreground">{customer?.email || ""}</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="grid md:grid-cols-2 gap-4 p-4">
          <div className="space-y-4">
            <DocumentList 
              documents={documents} 
              intakeStatus={intake.status as "Awaiting Tax Return" | "Incomplete" | "Ready"}
              intakeId={intakeId}
            />
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
            isUploading={uploadFilesMutation.isPending}
            isAiThinking={sendMessageMutation.isPending && !streamingMessage}
            customerStatus={intake.status as "Awaiting Tax Return" | "Incomplete" | "Ready"}
            progressStep={currentStep}
            progressMessage={progressMessage}
            progressValue={progressValue}
            customerId={customerId}
            intakeYear={intake.year}
            onConfirmMemory={handleConfirmMemory}
            onDismissMemory={handleDismissMemory}
            isConfirmingMemory={confirmMemoryMutation.isPending}
          />
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
