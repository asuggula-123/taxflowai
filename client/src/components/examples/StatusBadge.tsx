import { StatusBadge } from '../StatusBadge';

export default function StatusBadgeExample() {
  return (
    <div className="flex gap-4 items-center p-8">
      <StatusBadge status="Not Started" />
      <StatusBadge status="Incomplete" />
      <StatusBadge status="Ready" />
    </div>
  );
}
