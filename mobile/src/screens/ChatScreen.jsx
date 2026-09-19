import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../theme/theme';
import { createChatSession, fetchChatMessages, sendChatMessage } from '../api/client';

function EvidenceChips({ evidence, navigation }) {
  if (!evidence || evidence.length === 0) return null;
  const reportIds = [...new Set(evidence.filter((e) => e.type === 'report').map((e) => e.id))];
  if (reportIds.length === 0) return null;

  return (
    <View style={styles.evidenceRow}>
      {reportIds.map((id) => (
        <TouchableOpacity key={id} style={styles.evidenceChip} onPress={() => navigation.navigate('ReportDetail', { reportId: id })}>
          <Text style={styles.evidenceChipText}>View source</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function MessageBubble({ message, navigation }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[typography.body, isUser && styles.bubbleUserText]}>{message.content}</Text>
      </View>
      {!isUser && <EvidenceChips evidence={message.evidence} navigation={navigation} />}
    </View>
  );
}

export default function ChatScreen({ navigation }) {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    async function init() {
      try {
        const { session } = await createChatSession();
        setSessionId(session.id);
        const { messages: history } = await fetchChatMessages(session.id);
        setMessages(history);
      } catch (err) {
        console.warn('Failed to start chat session', err.message);
      }
    }
    init();
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || !sessionId || sending) return;
    setInput('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: text, evidence: [] }]);
    setSending(true);
    try {
      const { message } = await sendChatMessage(sessionId, text);
      setMessages((prev) => [...prev, message]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: 'assistant', content: `Sorry, something went wrong: ${err.message}`, evidence: [] },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListHeaderComponent={<Text style={[typography.title, styles.title]}>Ask MyHealthPal</Text>}
          ListEmptyComponent={
            <Text style={[typography.bodySecondary, styles.empty]}>
              Ask about your reports, e.g. "Summarize my latest report" or "Show my HbA1c trend".
            </Text>
          }
          renderItem={({ item }) => <MessageBubble message={item} navigation={navigation} />}
        />
        {sending && <ActivityIndicator style={styles.loading} color={colors.primary} />}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask a question about your health data…"
            placeholderTextColor={colors.textTertiary}
            multiline
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending || !input.trim()}>
            <Text style={styles.sendLabel}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  title: {
    marginBottom: spacing.md,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  bubbleRow: {
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
  },
  bubbleRowUser: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
  },
  bubbleUserText: {
    color: colors.surface,
  },
  evidenceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  evidenceChip: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  evidenceChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  loading: {
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 15,
    backgroundColor: colors.background,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  sendLabel: {
    color: colors.surface,
    fontWeight: '600',
  },
});
