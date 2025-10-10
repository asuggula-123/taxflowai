import { AddCustomerDialog } from "@/components/AddCustomerDialog";
import { CustomerList, Customer } from "@/components/CustomerList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (data: { name: string; email: string }) => {
      return await apiRequest("POST", "/api/customers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({
        title: "Customer added",
        description: "New customer has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create customer.",
        variant: "destructive",
      });
    },
  });

  const handleAddCustomer = (data: { name: string; email: string }) => {
    createCustomerMutation.mutate(data);
  };

  const handleCustomerClick = (customer: Customer) => {
    setLocation(`/customer/${customer.id}`);
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
          <h1 className="text-xl font-semibold">TaxFlow</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold">Customers</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Manage tax returns for your customers
            </p>
          </div>
          <AddCustomerDialog onAddCustomer={handleAddCustomer} />
        </div>

        <CustomerList customers={customers} onCustomerClick={handleCustomerClick} />
      </main>
    </div>
  );
}
