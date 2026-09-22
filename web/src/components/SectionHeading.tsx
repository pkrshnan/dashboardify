import { Separator } from '@/components/ui/separator';

import styles from './SectionHeading.module.css';

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.sectionHeading}>
      <h2>{children}</h2>
      <Separator />
    </div>
  );
}
