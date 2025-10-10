import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, CustomerStatus } from "./StatusBadge";
import { Mail, Trash2 } from "lucide-react";

export interface Customer {
  id: string;
  name: string;
  email: string;
  status: CustomerStatus;
}

interface CustomerListProps {
  customers: Customer[];
  onCustomerClick?: (customer: Customer) => void;
  onDeleteCustomer?: (customerId: string) => void;
}

export function CustomerList({ customers, onCustomerClick }: CustomerListProps) {
  return (
    <div className="space-y-2">
      {customers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No customers yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click "Add Customer" to get started
          </p>
        </div>
      ) : (
        customers.map((customer) => (
          <Card
            key={customer.id}
            className="p-4 hover-elevate active-elevate-2 cursor-pointer transition-all"
            onClick={() => onCustomerClick?.(customer)}
            data-testid={`card-customer-${customer.id}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate" data-testid={`text-customer-name-${customer.id}`}>
                  {customer.name}
                </h3>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                  <Mail className="h-3 w-3" />
                  <span className="truncate" data-testid={`text-customer-email-${customer.id}`}>
                    {customer.email}
                  </span>
                </div>
              </div>
              <StatusBadge status={customer.status} />
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
