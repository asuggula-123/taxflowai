import { CustomerDetailsPanel } from '../CustomerDetailsPanel';

export default function CustomerDetailsPanelExample() {
  const mockDetails: import('../CustomerDetailsPanel').CustomerDetailItem[] = [
    { label: 'Full Name', value: 'John Doe', category: 'Personal Info' },
    { label: 'SSN', value: '***-**-1234', category: 'Personal Info' },
    { label: 'Filing Status', value: 'Married Filing Jointly', category: 'Personal Info' },
    { label: 'W2 Income', value: '$85,000', category: 'Income Sources' },
    { label: '1099 Income', value: '$12,500', category: 'Income Sources' },
    { label: 'Mortgage Interest', value: '$8,200', category: 'Deductions' },
    { label: 'Charitable Donations', value: null, category: 'Deductions' },
  ];

  return (
    <div className="p-8 max-w-md">
      <CustomerDetailsPanel details={mockDetails} />
    </div>
  );
}
