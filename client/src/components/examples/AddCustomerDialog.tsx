import { AddCustomerDialog } from '../AddCustomerDialog';

export default function AddCustomerDialogExample() {
  return (
    <div className="p-8">
      <AddCustomerDialog onAddCustomer={(data) => console.log('Customer added:', data)} />
    </div>
  );
}
