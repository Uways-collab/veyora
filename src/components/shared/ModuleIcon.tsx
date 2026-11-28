import {
  BarChart3,
  Boxes,
  CreditCard,
  Building2,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Users,
  Home,
  Truck,
  Factory,
  ClipboardCheck,
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
    case 'restaurant_pos':
      return <ShoppingCart className={className} aria-hidden="true" />;
    case 'real_estate_leases':
    case 'real_estate_reports':
      return <Home className={className} aria-hidden="true" />;
    case 'logistics_dispatch':
    case 'logistics_tracking':
    case 'logistics_reports':
      return <Truck className={className} aria-hidden="true" />;
    case 'manufacturing_orders':
    case 'manufacturing_reports':
      return <Factory className={className} aria-hidden="true" />;
    case 'manufacturing_quality':
      return <ClipboardCheck className={className} aria-hidden="true" />;
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
    case 'ai_assistant':
      return <Sparkles className={className} aria-hidden="true" />;
    case 'billing':
      return <CreditCard className={className} aria-hidden="true" />;
    case 'settings':
      return <Settings className={className} aria-hidden="true" />;
    default:
      return <LayoutDashboard className={className} aria-hidden="true" />;
  }
}
