import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { Session } from './types';

export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Array<{ id: string; type: string }>>([
    { id: 'default-ops', type: 'Mock/Test Engine' },
  ]);
  const [selectedAgent, setSelectedAgent] = useState('default-ops');

  // Load available agents
  useEffect(() => {
    fetch('/api/agents')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (data.length > 0) {
          setAgents(data);
          setSelectedAgent(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Create new session
  const handleNewSession = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedAgent }),
      });

      if (res.ok) {
        const newSession: Session = await res.json();
        setSessions((prev) => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [selectedAgent]);

  // Initial bootstrap: create a session if none exist
  useEffect(() => {
    if (sessions.length === 0 && !activeSessionId) {
      handleNewSession();
    }
  }, [handleNewSession, sessions.length, activeSessionId]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0e0e11]">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => setActiveSessionId(id)}
        onNewSession={handleNewSession}
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={(id) => setSelectedAgent(id)}
      />
      <ChatView sessionId={activeSessionId} />
    </div>
  );
}

export default App;
