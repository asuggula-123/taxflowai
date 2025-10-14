import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, FileText, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
  const customerId = params?.id || "";

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
        <div className="max-w-5xl mx-auto space-y-6">
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
                  onClick={() => setLocation(`/customers/${customerId}/intakes/${intake.year}`)}
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
