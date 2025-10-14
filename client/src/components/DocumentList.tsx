import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export type DocumentStatus = "requested" | "completed";

export interface Document {
  id: string;
  name: string;
  status: DocumentStatus;
}

interface DocumentListProps {
  documents: Document[];
  customerStatus?: "Awaiting Tax Return" | "Incomplete" | "Ready";
}

export function DocumentList({ documents, customerStatus }: DocumentListProps) {
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

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Documents</h2>
      
      {customerStatus === "Awaiting Tax Return" && (
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
      
      <ScrollArea className="h-[300px]">
        <div className="space-y-2">
          {documents.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No documents yet
            </div>
          ) : (
            documents.map((doc) => (
              <Card
                key={doc.id}
                className={`p-3 flex items-start gap-3 ${getCardStyle(doc.status)}`}
                data-testid={`card-document-${doc.id}`}
              >
                <Badge
                  variant="outline"
                  className={`${getStatusColor(doc.status)} text-xs capitalize shrink-0 mt-0.5`}
                  data-testid={`badge-document-status-${doc.id}`}
                >
                  {doc.status}
                </Badge>
                <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <span className="flex-1 text-sm font-mono break-words">
                  {doc.name}
                </span>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
