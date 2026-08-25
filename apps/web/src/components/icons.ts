/**
 * Icon set.
 *
 * A single set (Lucide) at consistent sizes (docs/05 §5.8). Re-exported from
 * one module so the icon dependency has exactly one import site and swapping
 * sets later is a change here alone.
 *
 * Icons never carry meaning alone: every icon-only control has an aria-label,
 * and status icons are shape-differentiated (docs/05 §5.8, docs/27 §27.6).
 */

export {
  AlertOctagon,
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  ExternalLink as ExternalLinkIcon,
  FileText as FileTextIcon,
  GraduationCap,
  Info,
  Lock as LockIcon,
  LayoutDashboard,
  Plus,
  ShieldCheck as ShieldCheckIcon,
  Ban as SlashIcon,
  SquareSigma as CalcIcon,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
