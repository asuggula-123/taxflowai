import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, FileText, Calendar, Save } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AddIntakeModal } from "@/components/AddIntakeModal";
import type { Customer } from "@/components/CustomerList";

interface TaxYearIntake {
  id: string;
  customerId: string;
  year: string;
  notes: string | null;
  status: string;
  createdAt: string;
}

export default function CustomerSummary() {
  const [, params] = useRoute("/customers/:id");
  const [, setLocation] = useLocation();
  const [isAddIntakeModalOpen, setIsAddIntakeModalOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const initialNotesRef = useRef("");
  const customerId = params?.id || "";
  const { toast } = useToast();

  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    queryFn: async () => {
      const response = await fetch(`/api/customers/${customerId}`);
      if (!response.ok) throw new Error("Customer not found");
      return response.json();
    },
    enabled: !!customerId,
  });

  const { data: intakes = [] } = useQuery<TaxYearIntake[]>({
    queryKey: ["/api/customers", customerId, "intakes"],
    queryFn: async () => {
      const response = await fetch(`/api/customers/${customerId}/intakes`);
      return response.json();
    },
    enabled: !!customerId,
  });

  const { data: customerNotes } = useQuery<{ notes: string }>({
    queryKey: ["/api/customers", customerId, "notes"],
    queryFn: async () => {
      const response = await fetch(`/api/customers/${customerId}/notes`);
      return response.json();
    },
    enabled: !!customerId,
  });

  useEffect(() => {
    if (customerNotes && !hasUnsavedChanges) {
      const serverNotes = customerNotes.notes || "";
      setNotes(serverNotes);
      initialNotesRef.current = serverNotes;
    }
  }, [customerNotes, hasUnsavedChanges]);

  const updateNotesMutation = useMutation({
    mutationFn: async (newNotes: string) => {
      return await apiRequest("PUT", `/api/customers/${customerId}/notes`, { notes: newNotes });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update customer notes.",
        variant: "destructive",
      });
    },
  });

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasUnsavedChanges(value !== initialNotesRef.current);
  };

  const handleSaveNotes = () => {
    const valueToBeSaved = notes;
    updateNotesMutation.mutate(valueToBeSaved, {
      onSuccess: () => {
        initialNotesRef.current = valueToBeSaved;
        
        // Only reset if user hasn't typed more while saving
        setNotes((currentNotes) => {
          if (currentNotes === valueToBeSaved) {
            setHasUnsavedChanges(false);
            return valueToBeSaved;
          }
          // User typed more, keep their edits and maintain unsaved state
          setHasUnsavedChanges(true);
          return currentNotes;
        });
        
        queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "notes"] });
        toast({
          title: "Notes saved",
          description: "Customer notes have been updated successfully.",
        });
      },
    });
  };

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "Ready":
        return "default";
      case "Incomplete":
        return "secondary";
      case "Awaiting Tax Return":
        return "outline";
      default:
        return "secondary";
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "Ready":
        return "text-green-600 dark:text-green-400";
      case "Incomplete":
        return "text-yellow-600 dark:text-yellow-400";
      case "Awaiting Tax Return":
        return "text-blue-600 dark:text-blue-400";
      default:
        return "";
    }
  };

  if (!customer) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{customer.name}</h1>
            <p className="text-sm text-muted-foreground">{customer.email}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          <Tabs defaultValue="intakes" className="space-y-6">
            <TabsList data-testid="tabs-customer-summary">
              <TabsTrigger value="intakes" data-testid="tab-intakes">Tax Year Intakes</TabsTrigger>
              <TabsTrigger value="notes" data-testid="tab-notes">Customer Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="intakes" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Tax Year Intakes</h2>
                  <p className="text-muted-foreground">Manage tax returns for different years</p>
                </div>
                <Button onClick={() => setIsAddIntakeModalOpen(true)} data-testid="button-add-intake">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Intake
                </Button>
              </div>

              {intakes.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-lg font-medium mb-2">No tax year intakes yet</p>
                    <p className="text-sm text-muted-foreground mb-4">
                      Get started by adding a tax year intake
                    </p>
                    <Button onClick={() => setIsAddIntakeModalOpen(true)} data-testid="button-add-first-intake">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Intake
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {intakes.map((intake) => (
                    <Card
                      key={intake.id}
                      className="cursor-pointer hover-elevate active-elevate-2"
                      onClick={() => setLocation(`/customers/${customerId}/intakes/${intake.id}`)}
                      data-testid={`card-intake-${intake.year}`}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Calendar className="h-5 w-5 text-muted-foreground" />
                              <CardTitle className="text-xl">Tax Year {intake.year}</CardTitle>
                              <Badge variant={getStatusVariant(intake.status)} data-testid={`status-${intake.year}`}>
                                {intake.status}
                              </Badge>
                            </div>
                            {intake.notes && (
                              <CardDescription className="mt-2">{intake.notes}</CardDescription>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="notes" className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Customer Notes</h2>
                <p className="text-muted-foreground">
                  Material facts and recurring patterns specific to this taxpayer
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                  <CardDescription>
                    Track important customer-specific information (e.g., rental property ownership, self-employment status, recurring deductions)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    data-testid="textarea-customer-notes"
                    placeholder="e.g., Has rental property in Florida, Self-employed consultant, Always has charitable donations over $10k..."
                    value={notes}
                    onChange={(e) => handleNotesChange(e.target.value)}
                    className="min-h-[300px] resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    {hasUnsavedChanges && (
                      <p className="text-sm text-muted-foreground self-center" data-testid="text-unsaved">
                        Unsaved changes
                      </p>
                    )}
                    <Button
                      data-testid="button-save-notes"
                      onClick={handleSaveNotes}
                      disabled={!hasUnsavedChanges || updateNotesMutation.isPending}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {updateNotesMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <AddIntakeModal
        isOpen={isAddIntakeModalOpen}
        onClose={() => setIsAddIntakeModalOpen(false)}
        customerId={customerId}
        customerName={customer.name}
      />
    </div>
  );
}
