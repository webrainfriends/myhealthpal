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
import SpeakButton from '../components/SpeakButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import { createChatSession, fetchChatMessages, sendChatMessage } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { useVoice } from '../voice/VoiceContext';

function EvidenceChips({ evidence, navigation, t }) {
  if (!evidence || evidence.length === 0) return null;
  const reportIds = [...new Set(evidence.filter((e) => e.type === 'report').map((e) => e.id))];
  const medications = [
    ...new Map(evidence.filter((e) => e.type === 'medication').map((e) => [e.id, e])).values(),
  ];
  if (reportIds.length === 0 && medications.length === 0) return null;

  return (
    <View style={styles.evidenceRow}>
      {reportIds.map((id) => (
        <TouchableOpacity key={id} style={styles.evidenceChip} onPress={() => navigation.navigate('ReportDetail', { reportId: id })}>
          <Text style={styles.evidenceChipText}>{t('chat.viewSource')}</Text>
        </TouchableOpacity>
      ))}
      {medications.map((m) => (
        <TouchableOpacity
          key={m.id}
          style={styles.evidenceChip}
          onPress={() => navigation.navigate('MedicationDetail', { medicationId: m.id })}
        >
          <Text style={styles.evidenceChipText}>{m.label ? t('chat.viewNamed', { name: m.label }) : t('chat.viewMedication')}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function MessageBubble({ message, navigation, t }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[typography.body, isUser && styles.bubbleUserText]}>{message.content}</Text>
      </View>
      {!isUser && (
        <View style={styles.assistantFooter}>
          <SpeakButton id={message.id} text={message.content} label={t('chat.readAloud')} />
          <EvidenceChips evidence={message.evidence} navigation={navigation} t={t} />
        </View>
      )}
    </View>
  );
}

export default function ChatScreen({ navigation }) {
  const t = useT();
  const { enabled: voiceEnabled, speak } = useVoice();
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
      // Voice Mode reads each new answer aloud automatically, on top of the
      // per-bubble Listen button - so a person who can't see the screen
      // gets the reply without having to find and tap anything.
      if (voiceEnabled) speak(message.content, { id: message.id });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: 'assistant', content: t('chat.sorryError', { message: err.message }), evidence: [] },
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
          ListHeaderComponent={
            <View>
              <Text style={[typography.title, styles.title]}>{t('chat.title')}</Text>
              {voiceEnabled && <Text style={styles.autoReadHint}>{t('chat.autoReadHint')}</Text>}
            </View>
          }
          ListEmptyComponent={<Text style={[typography.bodySecondary, styles.empty]}>{t('chat.empty')}</Text>}
          renderItem={({ item }) => <MessageBubble message={item} navigation={navigation} t={t} />}
        />
        {sending && <ActivityIndicator style={styles.loading} color={colors.primary} />}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.textTertiary}
            multiline
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending || !input.trim()}>
            <Text style={styles.sendLabel}>{t('chat.send')}</Text>
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
  autoReadHint: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textTertiary,
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
  assistantFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  evidenceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
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
