import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, AlertCircle, Plus, Pencil, Trash2, Info } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const DOCUMENT_TYPES = [
  "Form 1040",
  "W-2",
  "1099-MISC",
  "1099-NEC",
  "1099-INT",
  "1099-DIV",
  "1099-G",
  "1099-R",
  "Schedule C",
  "Schedule E",
  "Schedule K-1",
  "Schedule A",
  "Form 1098",
  "Form 8949",
  "Form 2439",
  "Other",
] as const;

export type DocumentStatus = "requested" | "completed";

export interface Document {
  id: string;
  name: string;
  status: DocumentStatus;
  documentType?: string | null;
  year?: string | null;
  entity?: string | null;
  provenance?: string | null; // JSON string: {page?: number, lineReference?: string, evidence: string}
}

interface DocumentListProps {
  documents: Document[];
  intakeStatus?: "Awaiting Tax Return" | "Incomplete" | "Ready";
  intakeId?: string;
}

function AddEditDocumentDialog({ 
  intakeId,
  document,
  trigger 
}: { 
  intakeId: string;
  document?: Document;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [documentType, setDocumentType] = useState(document?.documentType || "");
  const [year, setYear] = useState(document?.year || "2024");
  const [entity, setEntity] = useState(document?.entity || "");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Sync form state when dialog opens or document changes
  useEffect(() => {
    if (open) {
      setDocumentType(document?.documentType || "");
      setYear(document?.year || "2024");
      setEntity(document?.entity || "");
    }
  }, [open, document]);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; documentType: string; year: string; entity?: string }) => {
      return await apiRequest("POST", `/api/intakes/${intakeId}/documents`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "documents"] });
      setOpen(false);
      toast({ title: "Document request created" });
      setDocumentType("");
      setYear("2024");
      setEntity("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; documentType: string; year: string; entity?: string }) => {
      return await apiRequest("PATCH", `/api/documents/${document?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "documents"] });
      setOpen(false);
      toast({ title: "Document request updated" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!documentType || !year) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }

    const name = entity 
      ? `${documentType} from ${entity} for ${year}`
      : `${documentType} for ${year}`;

    const payload = { 
      name, 
      documentType, 
      year,
      entity: entity || ""
    };

    if (document) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{document ? "Edit Document Request" : "Add Document Request"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="documentType">Document Type *</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger id="documentType" data-testid="select-document-type">
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="year">Tax Year *</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="year" data-testid="select-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2024">2024</SelectItem>
                <SelectItem value="2023">2023</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="entity">Entity/Payer Name (optional)</Label>
            <Input
              id="entity"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              placeholder="e.g., Microsoft, Chase Bank"
              data-testid="input-entity"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {document ? "Update" : "Add"} Document
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentList({ documents, intakeStatus, intakeId }: DocumentListProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const getStatusColor = (status: DocumentStatus) => {
    return status === "completed"
      ? "bg-status-ready/10 text-status-ready border-status-ready/20"
      : "bg-status-incomplete/10 text-status-incomplete border-status-incomplete/20";
  };

  const getCardStyle = (status: DocumentStatus) => {
    return status === "completed"
      ? "border-status-ready/20"
      : "border-status-incomplete/30 border-dashed";
  };

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      return await apiRequest("DELETE", `/api/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/intakes", intakeId, "documents"] });
      toast({ title: "Document request deleted" });
    },
  });

  const handleDelete = (documentId: string) => {
    if (confirm("Are you sure you want to delete this document request?")) {
      deleteMutation.mutate(documentId);
    }
  };

  // Split documents by year
  const contextDocs = documents.filter(doc => doc.year === "2023");
  const neededDocs = documents.filter(doc => doc.year === "2024" || !doc.year);
  
  const renderDocument = (doc: Document) => (
    <Card
      key={doc.id}
      className={`p-3 flex items-start gap-2 ${getCardStyle(doc.status)}`}
      data-testid={`card-document-${doc.id}`}
    >
      <Badge
        variant="outline"
        className={`${getStatusColor(doc.status)} text-xs capitalize shrink-0`}
        data-testid={`badge-document-status-${doc.id}`}
      >
        {doc.status}
      </Badge>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {doc.documentType && (
            <Badge 
              variant="secondary" 
              className="text-xs shrink-0"
              data-testid={`badge-document-type-${doc.id}`}
            >
              {doc.documentType}
            </Badge>
          )}
          {doc.year && (
            <Badge 
              variant="outline" 
              className="text-xs shrink-0"
              data-testid={`badge-document-year-${doc.id}`}
            >
              {doc.year}
            </Badge>
          )}
          {doc.entity && (
            <Badge 
              variant="outline" 
              className="text-xs shrink-0"
              data-testid={`badge-document-entity-${doc.id}`}
            >
              {doc.entity}
            </Badge>
          )}
        </div>
        <p className="text-sm break-words" data-testid={`text-document-name-${doc.id}`}>
          {doc.name}
        </p>
      </div>
      
      {doc.provenance ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info 
                className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 cursor-help" 
                data-testid={`icon-provenance-${doc.id}`}
              />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {(() => {
                try {
                  const prov = JSON.parse(doc.provenance);
                  return (
                    <div className="space-y-1">
                      {prov.lineReference && (
                        <p className="text-xs font-medium">{prov.lineReference}</p>
                      )}
                      {prov.evidence && (
                        <p className="text-xs text-muted-foreground">{prov.evidence}</p>
                      )}
                      {prov.page && (
                        <p className="text-xs text-muted-foreground">Page {prov.page}</p>
                      )}
                    </div>
                  );
                } catch {
                  return <p className="text-xs">Source information available</p>;
                }
              })()}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      )}
      
      {doc.status === "requested" && intakeId && (
        <div className="flex gap-1 shrink-0">
          <AddEditDocumentDialog
            intakeId={intakeId}
            document={doc}
            trigger={
              <Button 
                size="icon" 
                variant="ghost" 
                className="h-7 w-7"
                data-testid={`button-edit-${doc.id}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <Button 
            size="icon" 
            variant="ghost" 
            className="h-7 w-7"
            onClick={() => handleDelete(doc.id)}
            disabled={deleteMutation.isPending}
            data-testid={`button-delete-${doc.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Documents</h2>
        {intakeId && intakeStatus !== "Awaiting Tax Return" && (
          <AddEditDocumentDialog
            intakeId={intakeId}
            trigger={
              <Button size="sm" data-testid="button-add-document">
                <Plus className="h-4 w-4 mr-1" />
                Add Document
              </Button>
            }
          />
        )}
      </div>
      
      {intakeStatus === "Awaiting Tax Return" && (
        <Card className="p-4 bg-primary/5 border-primary/20" data-testid="alert-awaiting-tax-return">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-primary">
                First Step: Upload 2023 Tax Return
              </p>
              <p className="text-sm text-muted-foreground">
                Please upload the customer's complete 2023 Form 1040 tax return to begin. 
                The system will validate it and unlock additional features.
              </p>
            </div>
          </div>
        </Card>
      )}
      
      <ScrollArea className="h-[400px]">
        <div className="space-y-6">
          {/* Prior Year Context Documents (2023) */}
          {contextDocs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  2023 Context Documents
                </h3>
                <div className="flex-1 h-px bg-border" />
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Prior year documents analyzed to determine current year needs
              </p>
              <div className="space-y-2">
                {contextDocs.map(renderDocument)}
              </div>
            </div>
          )}

          {/* Current Year Needed Documents (2024) */}
          {neededDocs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">
                  2024 Documents Needed
                </h3>
                <div className="flex-1 h-px bg-border" />
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Documents to collect for 2024 tax return
              </p>
              <div className="space-y-2">
                {neededDocs.map(renderDocument)}
              </div>
            </div>
          )}

          {documents.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No documents yet
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
