import {
  BarChart3,
  Boxes,
  Building2,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Users,
} from 'lucide-react';
import type { ModuleId } from '../../core/types/domain';

interface ModuleIconProps {
  moduleId: ModuleId;
  className?: string;
}

export function ModuleIcon({ moduleId, className = 'h-4 w-4' }: ModuleIconProps) {
  switch (moduleId) {
    case 'dashboard':
      return <LayoutDashboard className={className} aria-hidden="true" />;
    case 'inventory':
      return <Boxes className={className} aria-hidden="true" />;
    case 'sales':
      return <ShoppingBag className={className} aria-hidden="true" />;
    case 'customers':
      return <Users className={className} aria-hidden="true" />;
    case 'purchases':
      return <ShoppingCart className={className} aria-hidden="true" />;
    case 'suppliers':
      return <Building2 className={className} aria-hidden="true" />;
    case 'expenses':
      return <Receipt className={className} aria-hidden="true" />;
    case 'finance':
      return <Landmark className={className} aria-hidden="true" />;
    case 'reports':
      return <BarChart3 className={className} aria-hidden="true" />;
    case 'settings':
      return <Settings className={className} aria-hidden="true" />;
  }
}
