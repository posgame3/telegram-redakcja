import { useEffect, useRef } from "react";
import type { Publication } from "../../shared/types";
import { withImageVariant } from "../media";
import { headlineOf } from "../publication";

interface PhotoDialogProps {
  item: Publication | null;
  onClose: () => void;
}

/** Pelny podglad zdjecia. Otwierany dotknieciem kadru albo przyciskiem Powiększ. */
export function PhotoDialog({ item, onClose }: PhotoDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const image = item?.image ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (image && !dialog.open) dialog.showModal();
    if (!image && dialog.open) dialog.close();
  }, [image]);

  return (
    <dialog
      ref={dialogRef}
      className="photo-dialog"
      aria-label="Podgląd zdjęcia"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      {item && image && (
        <div className="photo-panel">
          <img src={withImageVariant(image.url, "full")} alt={image.alt || headlineOf(item)} />
          <div className="photo-bar">
            <span>{image.credit ? `Fot. ${image.credit}` : ""}</span>
            <button type="button" onClick={onClose} autoFocus>
              Zamknij
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
