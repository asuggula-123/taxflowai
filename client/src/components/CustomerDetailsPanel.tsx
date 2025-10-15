import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface CustomerDetailItem {
  label: string;
  value: any; // Can be string, number, object, or null
  category: string;
}

// Helper function to safely format any value for display
function formatValueForDisplay(value: any): string {
  if (value === null || value === undefined) {
    return "—";
  }
  
  if (typeof value === "string") {
    return value;
  }
  
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  
  if (typeof value === "object") {
    // If it's an object like {Salary: 51484.88, Commission: 0}
    // Format it as "Salary: $51,484.88, Commission: $0"
    const entries = Object.entries(value).filter(([_, v]) => v !== null && v !== undefined && v !== 0);
    if (entries.length === 0) return "—";
    
    return entries
      .map(([key, val]) => {
        // Format currency values
        if (typeof val === 'number') {
          return `${key}: $${val.toLocaleString()}`;
        }
        return `${key}: ${val}`;
      })
      .join(", ");
  }
  
  return String(value);
}

interface CustomerDetailsPanelProps {
  details: CustomerDetailItem[];
}

export function CustomerDetailsPanel({ details }: CustomerDetailsPanelProps) {
  // Filter out internal/technical categories like TaxEntities (raw JSON)
  const userFriendlyDetails = details.filter(
    (d) => d.category.toUpperCase() !== "TAXENTITIES"
  );
  
  const categories = Array.from(new Set(userFriendlyDetails.map((d) => d.category)));

  if (userFriendlyDetails.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Customer Details</h2>
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            No details extracted yet. Upload tax documents to populate this section.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Customer Details</h2>
      <ScrollArea className="h-[300px]">
        <div className="space-y-6">
          {categories.map((category) => (
            <div key={category} className="space-y-3">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                {category}
              </h3>
              <div className="space-y-2">
                {userFriendlyDetails
                  .filter((d) => d.category === category)
                  .map((detail, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-start gap-4"
                      data-testid={`detail-${detail.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <span className="text-sm text-muted-foreground">
                        {detail.label}
                      </span>
                      <span className="text-sm font-medium text-right">
                        {formatValueForDisplay(detail.value)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
