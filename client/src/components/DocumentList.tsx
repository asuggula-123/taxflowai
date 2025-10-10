import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export type DocumentStatus = "requested" | "completed";

export interface Document {
  id: string;
  name: string;
  status: DocumentStatus;
}

interface DocumentListProps {
  documents: Document[];
}

export function DocumentList({ documents }: DocumentListProps) {
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
                className={`p-3 flex items-center gap-3 ${getCardStyle(doc.status)}`}
                data-testid={`card-document-${doc.id}`}
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm font-mono truncate">
                  {doc.name}
                </span>
                <Badge
                  variant="outline"
                  className={`${getStatusColor(doc.status)} text-xs capitalize`}
                  data-testid={`badge-document-status-${doc.id}`}
                >
                  {doc.status}
                </Badge>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
