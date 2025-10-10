import { useState } from "react";
import { AddCustomerDialog } from "@/components/AddCustomerDialog";
import { CustomerList, Customer } from "@/components/CustomerList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLocation } from "wouter";

export default function Home() {
  //todo: remove mock functionality
  const [customers, setCustomers] = useState<Customer[]>([
    { id: "1", name: "John Smith", email: "john.smith@email.com", status: "Ready" },
    { id: "2", name: "Sarah Johnson", email: "sarah.j@company.com", status: "Incomplete" },
    { id: "3", name: "Michael Chen", email: "mchen@business.net", status: "Not Started" },
  ]);

  const [, setLocation] = useLocation();

  const handleAddCustomer = (data: { name: string; email: string }) => {
    const newCustomer: Customer = {
      id: String(Date.now()),
      name: data.name,
      email: data.email,
      status: "Not Started",
    };
    setCustomers([...customers, newCustomer]);
  };

  const handleCustomerClick = (customer: Customer) => {
    setLocation(`/customer/${customer.id}`);
  };

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
