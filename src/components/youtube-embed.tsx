import "lite-youtube-embed/src/lite-yt-embed.css";

import { LiteYouTubeActivation } from "./lite-youtube-activation";

// Click-to-load facade for the post's associated video_url (design §5.1):
// a static poster + play button that only loads the real YouTube player
// (youtube-nocookie.com) when tapped — eager YouTube iframes wreck mobile
// load performance. Server-rendered; the activation island upgrades it on
// the client, and the anchor child is the no-JS fallback (lite-youtube
// converts it to the play button when active).
export function YouTubeEmbed({
  videoId,
  title,
}: {
  videoId: string;
  title?: string;
}) {
  const playLabel = title ? `Play: ${title}` : "Play video";
  return (
    <>
      <LiteYouTubeActivation />
      <lite-youtube
        className="youtube-embed"
        videoid={videoId}
        title={title ?? "YouTube video"}
        playlabel={playLabel}
      >
        <a
          className="lyt-playbtn"
          href={`https://www.youtube.com/watch?v=${videoId}`}
        >
          <span className="lyt-visually-hidden">{playLabel}</span>
        </a>
      </lite-youtube>
    </>
  );
}
