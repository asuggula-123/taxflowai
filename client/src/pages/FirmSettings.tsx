import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";
import { Link } from "wouter";

export default function FirmSettings() {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const initialNotesRef = useRef("");

  const { data: firmSettings, isLoading } = useQuery<{ notes: string }>({
    queryKey: ["/api/firm/settings"],
  });

  useEffect(() => {
    if (firmSettings && !hasUnsavedChanges) {
      const serverNotes = firmSettings.notes || "";
      setNotes(serverNotes);
      initialNotesRef.current = serverNotes;
    }
  }, [firmSettings, hasUnsavedChanges]);

  const updateNotesMutation = useMutation({
    mutationFn: async (newNotes: string) => {
      return await apiRequest("PUT", "/api/firm/settings", { notes: newNotes });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update firm settings.",
        variant: "destructive",
      });
    },
  });

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasUnsavedChanges(value !== initialNotesRef.current);
  };

  const handleSave = () => {
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
        
        queryClient.invalidateQueries({ queryKey: ["/api/firm/settings"] });
        toast({
          title: "Settings saved",
          description: "Firm settings have been updated successfully.",
        });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-semibold">Firm Settings</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Standing Instructions</CardTitle>
            <CardDescription>
              Global rules, policies, and processes that apply to all customers.
              The AI will use these instructions when working with any customer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              data-testid="textarea-firm-notes"
              placeholder="e.g., Always ask about HSA contributions, Request crypto transactions for all clients, State forms due by March 1st..."
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
                data-testid="button-save"
                onClick={handleSave}
                disabled={!hasUnsavedChanges || updateNotesMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {updateNotesMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
