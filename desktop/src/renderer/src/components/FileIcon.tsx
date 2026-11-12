import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { fileVisual, type FileVisual } from '../lib/format';

const ICONS: Record<FileVisual, { icon: LucideIcon; tone: string }> = {
  image: { icon: FileImage, tone: 'red' },
  pdf: { icon: FileText, tone: 'red' },
  doc: { icon: FileText, tone: 'blue' },
  sheet: { icon: FileSpreadsheet, tone: 'green' },
  slide: { icon: Presentation, tone: 'yellow' },
  archive: { icon: FileArchive, tone: 'gray' },
  video: { icon: FileVideo, tone: 'red' },
  audio: { icon: FileAudio, tone: 'purple' },
  text: { icon: FileText, tone: 'gray' },
  other: { icon: File, tone: 'gray' },
};

export function FileIcon({ name, mime, size = 20 }: { name: string; mime: string; size?: number }) {
  const { icon: Icon, tone } = ICONS[fileVisual(name, mime)];
  return <Icon size={size} className={`file-icon tone-${tone}`} aria-hidden />;
}
