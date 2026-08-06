import { Show } from 'solid-js';
import type { WhatsNewPost } from '../../types.ts';
import type { WhatsNewEventRow } from '../../services.ts';
import { PostEngagement, completionRateOf, funnelCounts } from '../views/WhatsNewEngagement.tsx';

// Mean stats across every post that has recorded at least one event
// (zero-event posts are excluded so drafts don't drag the averages down)
export interface WhatsNewFleetAverages {
  posts: number;
  seen: number;
  completed: number;
  skipped: number;
  completionRate: number | null; // mean of per-post rates, posts with seen > 0
}

interface WhatsNewStatsModalProps {
  post: WhatsNewPost;
  rows: WhatsNewEventRow[];
  averages: WhatsNewFleetAverages | null;
  onClose: () => void;
}

export function WhatsNewStatsModal(props: WhatsNewStatsModalProps) {
  const counts = () => funnelCounts(props.rows);
  const rate = () => completionRateOf(counts());
  // Comparing a post against an average it dominates is meaningless noise at
  // n=1, so the table only appears once a second post has data
  const comparable = () => {
    const a = props.averages;
    return a && a.posts > 1 && props.rows.length > 0 ? a : null;
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 860px">
        <div class="modal-header">
          <h2>Post Engagement</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="wn-stats-post-line">
            <span class="wn-stats-post-title">{props.post.title.en}</span>
            <span class="whats-new-version">v{props.post.version}</span>
          </div>

          <PostEngagement rows={props.rows} />

          <Show when={comparable()}>
            {(avg) => (
              <>
                <div class="whats-new-section-label whats-new-section-gap">Versus other posts</div>
                <div class="wn-stats-table-wrap">
                  <table class="wn-stats-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>This post</th>
                        <th>Average of {avg().posts} posts with data</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Seen</td>
                        <td class="wn-this">{counts().seen}</td>
                        <td>{avg().seen}</td>
                      </tr>
                      <tr>
                        <td>Completed</td>
                        <td class="wn-this">{counts().completed}</td>
                        <td>{avg().completed}</td>
                      </tr>
                      <tr>
                        <td>Skipped</td>
                        <td class="wn-this">{counts().skipped}</td>
                        <td>{avg().skipped}</td>
                      </tr>
                      <tr>
                        <td>Completion rate</td>
                        <td class="wn-this">{rate() !== null ? `${rate()}%` : '—'}</td>
                        <td>{avg().completionRate !== null ? `${avg().completionRate}%` : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
