import { useState } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AddIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
}

export function AddIntakeModal({ isOpen, onClose, customerId, customerName }: AddIntakeModalProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [year, setYear] = useState("");
  const [notes, setNotes] = useState("");

  // Generate year options (current year + next year, and previous 3 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = [
    currentYear + 1,
    currentYear,
    currentYear - 1,
    currentYear - 2,
    currentYear - 3,
  ];

  const createIntakeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/customers/${customerId}/intakes`, {
        year,
        notes: notes.trim() || null,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "intakes"] });
      toast({
        title: "Intake created",
        description: `Tax year ${year} intake has been created for ${customerName}.`,
      });
      onClose();
      setYear("");
      setNotes("");
      // Navigate to the new intake page using the UUID
      setLocation(`/customers/${customerId}/intakes/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create intake",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!year) {
      toast({
        title: "Year required",
        description: "Please select a tax year.",
        variant: "destructive",
      });
      return;
    }
    createIntakeMutation.mutate();
  };

  const handleClose = () => {
    if (!createIntakeMutation.isPending) {
      setYear("");
      setNotes("");
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent data-testid="modal-add-intake">
        <DialogHeader>
          <DialogTitle>Add Tax Year Intake</DialogTitle>
          <DialogDescription>
            Create a new tax year intake for {customerName}. You'll be asked to upload the previous year's
            Form 1040 to get started.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="year">Tax Year *</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="year" data-testid="select-year">
                <SelectValue placeholder="Select tax year" />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={y.toString()} data-testid={`year-option-${y}`}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              data-testid="input-notes"
              placeholder="Add any notes about this tax year (e.g., 'Joint filing with spouse', 'First year with rental property')"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createIntakeMutation.isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!year || createIntakeMutation.isPending}
              data-testid="button-create-intake"
            >
              {createIntakeMutation.isPending ? "Creating..." : "Create Intake"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
