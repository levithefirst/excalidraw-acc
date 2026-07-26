import "./globals.css";

export const metadata = {
  title: "sketchdrop — text in, editable excalidraw out",
  description:
    "paste anything. get a real .excalidraw file with your people in it and a color budget you control. editable, not a screenshot.",
  openGraph: {
    title: "sketchdrop",
    description: "AI turns your text into a native, editable excalidraw file. avatars in, color budget enforced.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "sketchdrop",
    description: "AI turns your text into a native, editable excalidraw file.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
