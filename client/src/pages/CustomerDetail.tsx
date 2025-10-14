import { useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DocumentList } from "@/components/DocumentList";
import { CustomerDetailsPanel } from "@/components/CustomerDetailsPanel";
import { ChatInterface } from "@/components/ChatInterface";
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

  const messages = rawMessages.map((m: any) => ({
    ...m,
    timestamp: new Date(m.createdAt || Date.now()),
  }));

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      return await apiRequest("POST", `/api/intakes/${intakeId}/messages`, {
        sender: "accountant",
        content,
      });
    },
    onMutate: async (content: string) => {
      // Cancel any outgoing refetches to avoid optimistic update being overwritten
      await queryClient.cancelQueries({ queryKey: ["/api/intakes", intakeId, "messages"] });

      // Optimistically update to show user's message immediately
      const tempId = `temp-${Date.now()}`;
      const optimisticMessage = {
        id: tempId,
        intakeId,
        sender: "accountant" as const,
        content,
        createdAt: new Date().toISOString(),
      };

      queryClient.setQueryData(
        ["/api/intakes", intakeId, "messages"],
        (old: any[] = []) => [...old, optimisticMessage]
      );

      // Return context with temp ID for potential rollback
      return { tempId };
    },
    onSuccess: () => {
      // Invalidate to fetch the real messages (including AI response)
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "details"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId] });
    },
    onError: (err, _variables, context) => {
      // Remove only the specific failed message, preserving other messages
      if (context?.tempId) {
        queryClient.setQueryData(
          ["/api/intakes", intakeId, "messages"],
          (old: any[] = []) => old.filter((msg) => msg.id !== context.tempId)
        );
      }
      
      // Show error to user
      toast({
        title: "Failed to send message",
        description: "Your message could not be sent. Please try again.",
        variant: "destructive",
      });
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

      if (!response.ok) throw new Error("Upload failed");
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
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Upload complete",
        description: "Documents uploaded and analyzed successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Upload failed",
        description: "Failed to upload documents.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSendMessage = (message: string) => {
    sendMessageMutation.mutate(message);
  };

  const handleFileUpload = (files: FileList) => {
    uploadFilesMutation.mutate(files);
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
            isAiThinking={sendMessageMutation.isPending}
            customerStatus={intake.status as "Awaiting Tax Return" | "Incomplete" | "Ready"}
            progressStep={currentStep}
            progressMessage={progressMessage}
            progressValue={progressValue}
          />
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
