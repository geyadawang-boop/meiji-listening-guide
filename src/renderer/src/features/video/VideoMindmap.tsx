import {noteGroups, type VideoNotePoint} from '@shared/video-notes'
export function VideoMindmap({title, points}: {title: string; points: VideoNotePoint[]}) {
 return (
  <div className="video-mindmap" aria-label="课程思维导图">
   <div className="video-mindmap-root">
    {title}
    <small>{points.length} 项字幕要点</small>
   </div>
   <div className="video-mindmap-branches">
    {noteGroups(points).map(group => (
     <details open key={group.title}>
      <summary>
       {group.title}
       <span>{group.items.length}</span>
      </summary>
      <div>
       {group.items.map((point, i) => (
        <article key={i}>
         <strong>{point.point}</strong>
         <small>{point.timestamp}</small>
         <p>“{point.quote}”</p>
        </article>
       ))}
      </div>
     </details>
    ))}
   </div>
  </div>
 )
}
