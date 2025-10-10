import { Badge } from "@/components/ui/badge";

export type CustomerStatus = "Not Started" | "Incomplete" | "Ready";

interface StatusBadgeProps {
  status: CustomerStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getStatusColor = (status: CustomerStatus) => {
    switch (status) {
      case "Ready":
        return "bg-status-ready/10 text-status-ready border-status-ready/20";
      case "Incomplete":
        return "bg-status-incomplete/10 text-status-incomplete border-status-incomplete/20";
      case "Not Started":
        return "bg-status-notStarted/10 text-status-notStarted border-status-notStarted/20";
    }
  };

  return (
    <Badge 
      variant="outline" 
      className={`${getStatusColor(status)} text-xs font-medium`}
      data-testid={`badge-status-${status.toLowerCase().replace(' ', '-')}`}
    >
      {status}
    </Badge>
  );
}
