import type { Publication } from "../../shared/types";

interface ReaderSheetProps {
  item: Publication;
  open: boolean;
  onClose: () => void;
}

/**
 * Panel zrodel materialu. Zawiera wylacznie odnosniki do oryginalow - tresc
 * materialu jest na karcie, wiec nie powtarzamy jej tutaj.
 */
export function ReaderSheet({ item, open, onClose }: ReaderSheetProps) {
  return (
    <div className="reader-sheet" hidden={!open}>
      <div className="reader-sheet-bar">
        <span>Źródła materiału</span>
        <button type="button" onClick={onClose}>
          Zwiń
        </button>
      </div>
      <div className="reader-sheet-body">
        <div className="reader-sources-head">
          <span>Publikacje źródłowe</span>
          <span>{item.sourceCount}</span>
        </div>
        <ol className="reader-sources">
          {item.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
              <small>
                {source.domain} · {source.time}
              </small>
            </li>
          ))}
        </ol>
        <p className="reader-sources-note">
          Każdy telegram powstaje z co najmniej dwóch niezależnych publikacji. Odnośniki prowadzą do
          oryginałów.
        </p>
      </div>
    </div>
  );
}
