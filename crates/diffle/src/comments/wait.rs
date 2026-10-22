//! Which threads a live review's agent still owes an answer.
use crate::protocol::{CommentThread, MessageAuthor};

/// Threads waiting on an agent: open, still anchored, and the agent did not write the last message.
pub fn awaiting_agent(threads: Vec<CommentThread>) -> Vec<CommentThread> {
    threads
        .into_iter()
        .filter(|t| !t.resolved && !t.stale && t.messages.last().and_then(|m| m.author) != Some(MessageAuthor::Agent))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{CommentAnchor, CommentMessage};

    fn msg(body: &str, author: Option<MessageAuthor>) -> CommentMessage {
        CommentMessage { id: body.into(), body: body.into(), author, created_at: 1, updated_at: 1 }
    }

    fn thread(id: &str, messages: Vec<CommentMessage>, resolved: bool, stale: bool) -> CommentThread {
        CommentThread {
            id: id.into(),
            anchor: CommentAnchor::File { path: "a.ts".into() },
            messages,
            resolved,
            resolved_at: None,
            stale,
            stale_from_line: None,
        }
    }

    #[test]
    fn keeps_open_anchored_threads_whose_last_message_is_not_the_agents() {
        let agent = Some(MessageAuthor::Agent);
        let threads = vec![
            thread("asked", vec![msg("why?", None)], false, false),
            thread("answered", vec![msg("why?", None), msg("because", agent)], false, false),
            thread(
                "followed-up",
                vec![msg("why?", None), msg("because", agent), msg("still wrong", None)],
                false,
                false,
            ),
            thread("resolved", vec![msg("why?", None)], true, false),
            thread("stale", vec![msg("why?", None)], false, true),
            thread("agent-opened", vec![msg("worth a test?", agent)], false, false),
        ];
        let ids: Vec<String> = awaiting_agent(threads).into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["asked", "followed-up"]);
    }
}
