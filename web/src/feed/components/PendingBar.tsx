import { pluralNews } from "../../shared/format";

interface PendingBarProps {
  count: number;
  onShow: () => void;
}

/**
 * Pasek z liczba nowych materialow. Klikniecie dopiero podmienia liste, zeby
 * tresc nie zmieniala sie pod palcem czytajacego.
 */
export function PendingBar({ count, onShow }: PendingBarProps) {
  return (
    <button className="pending-bar" type="button" hidden={count === 0} onClick={onShow}>
      {count > 0 && (
        <>
          <span className="pending-bar-dot" aria-hidden="true" />
          {`${count} ${pluralNews(count)} — pokaż`}
        </>
      )}
    </button>
  );
}
