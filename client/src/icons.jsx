import {
  Play, Clock, Webhook, Braces, TerminalSquare, Globe, GitBranch, Wand2, Hourglass,
  Repeat, CornerDownLeft, Workflow, MousePointerClick, Monitor, Plug, MessageSquare,
  MessageCircle, Mail, Sparkles, Cpu, CircleDot,
} from 'lucide-react';

const MAP = {
  play: Play,
  clock: Clock,
  webhook: Webhook,
  braces: Braces,
  terminal: TerminalSquare,
  globe: Globe,
  'git-branch': GitBranch,
  wand: Wand2,
  hourglass: Hourglass,
  repeat: Repeat,
  'corner-down-left': CornerDownLeft,
  workflow: Workflow,
  'mouse-pointer-click': MousePointerClick,
  monitor: Monitor,
  plug: Plug,
  'message-square': MessageSquare,
  'message-circle': MessageCircle,
  mail: Mail,
  sparkles: Sparkles,
};

export function NodeIcon({ name, size = 14 }) {
  const Icon = MAP[name] || Cpu;
  return <Icon size={size} strokeWidth={1.8} />;
}

export { CircleDot };
