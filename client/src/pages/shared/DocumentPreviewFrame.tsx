type DocumentPreviewFrameProps = {
  html: string;
  title: string;
};

const DocumentPreviewFrame = ({ html, title }: DocumentPreviewFrameProps) => (
  <iframe
    className="preview-frame"
    title={title}
    srcDoc={html}
    sandbox=""
    loading="lazy"
    referrerPolicy="no-referrer"
  />
);

export default DocumentPreviewFrame;
