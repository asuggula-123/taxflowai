import { DocumentList } from '../DocumentList';

export default function DocumentListExample() {
  const mockDocuments = [
    { id: '1', name: '2023_tax_return.pdf', status: 'completed' as const },
    { id: '2', name: 'W2_form.pdf', status: 'requested' as const },
    { id: '3', name: '1099_misc.pdf', status: 'requested' as const },
    { id: '4', name: 'business_expenses.xlsx', status: 'completed' as const },
  ];

  return (
    <div className="p-8 max-w-md">
      <DocumentList documents={mockDocuments} />
    </div>
  );
}
