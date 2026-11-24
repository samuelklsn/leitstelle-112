import { useTranslation } from 'react-i18next';
import css from './Panels.module.css';

/** FMS-Status als Farbe *und* Ziffer – Farbe ist nie die einzige Kodierung (Barrierearmut). */
export function FmsChip({ status }: { status: number }) {
  const { t } = useTranslation();
  return (
    <span
      className={`${css.fms ?? ''} ${status === 5 ? (css.fmsBlink ?? '') : ''}`}
      style={{ background: `var(--fms-${status.toString()})` }}
      title={t(`fms.${status.toString()}`)}
    >
      {status}
    </span>
  );
}
