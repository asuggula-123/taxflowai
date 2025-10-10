import { CustomerList } from '../CustomerList';

export default function CustomerListExample() {
  const mockCustomers = [
    { id: '1', name: 'John Smith', email: 'john.smith@email.com', status: 'Ready' as const },
    { id: '2', name: 'Sarah Johnson', email: 'sarah.j@company.com', status: 'Incomplete' as const },
    { id: '3', name: 'Michael Chen', email: 'mchen@business.net', status: 'Not Started' as const },
    { id: '4', name: 'Emily Davis', email: 'emily.davis@mail.com', status: 'Incomplete' as const },
  ];

  return (
    <div className="p-8 max-w-2xl">
      <CustomerList
        customers={mockCustomers}
        onCustomerClick={(customer) => console.log('Clicked:', customer.name)}
      />
    </div>
  );
}
