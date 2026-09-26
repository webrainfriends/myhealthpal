import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import {
  createFamilyInvite,
  createFamilyMember,
  fetchFamily,
  fetchSupportedLanguages,
  redeemFamilyInvite,
  removeFamilyMember,
  revokeFamilyAccess,
  updateFamilyMember,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';

const RELATIONS = ['mother', 'father', 'spouse', 'child', 'grandparent', 'sibling', 'other'];

// Relations picked in-app are keys (mother, father, ...); anything else
// (e.g. set via an invite) is shown as typed.
function relationLabel(relation, t) {
  if (!relation) return null;
  const key = `family.relation.${relation.toLowerCase()}`;
  const label = t(key);
  return label === key ? relation : label;
}

function accessLabel(profile, t) {
  if (profile.isSelf) return t('family.you');
  if (profile.access === 'view') return t('family.viewOnly');
  return profile.isManaged ? t('family.managedByYou') : t('family.canManage');
}

function ProfileRow({ profile, active, languages, t, onSwitch, onShare, onRemove, onLanguage }) {
  const [sharing, setSharing] = useState(false);
  const canShare = profile.isSelf || profile.access === 'manage';
  const relation = relationLabel(profile.relation, t);
  return (
    <View style={[styles.card, cardShadow, active && styles.cardActive]}>
      <TouchableOpacity style={styles.profileRow} onPress={() => onSwitch(profile)} activeOpacity={0.7}>
        <View style={[styles.avatar, active && styles.avatarActive]}>
          <Text style={[styles.avatarText, active && styles.avatarTextActive]}>
            {(profile.displayName || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileText}>
          <Text style={typography.heading}>{profile.isSelf ? t('family.myHealth') : profile.displayName}</Text>
          <Text style={typography.caption}>{[relation, accessLabel(profile, t)].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text style={[styles.switchLabel, active && styles.switchLabelActive]}>
          {active ? t('family.viewing') : t('family.view')}
        </Text>
      </TouchableOpacity>

      {active && profile.isManaged && profile.access === 'manage' && languages.length > 0 && (
        <ChipSelect
          label={t('family.summaryLanguage')}
          options={languages}
          value={profile.preferredLanguage}
          allowClear={false}
          onChange={(code) => onLanguage(profile, code)}
        />
      )}

      {(canShare || !profile.isSelf) && (
        <View style={styles.rowActions}>
          {canShare && (
            <TouchableOpacity onPress={() => setSharing((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.actionLabel}>{t('family.share')}</Text>
            </TouchableOpacity>
          )}
          {!profile.isSelf && (
            <TouchableOpacity onPress={() => onRemove(profile)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.actionLabel, styles.dangerLabel]}>{t('family.remove')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {sharing && (
        <View style={styles.sharePanel}>
          <Text style={typography.caption}>{t('family.shareMessage')}</Text>
          <View style={styles.rowActions}>
            <TouchableOpacity onPress={() => onShare(profile, 'view')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.actionLabel}>{t('family.shareViewOnly')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onShare(profile, 'manage')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.actionLabel}>{t('family.shareManage')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

export default function FamilyScreen({ navigation }) {
  const t = useT();
  const { activeProfile, switchProfile } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [sharedWith, setSharedWith] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('mother');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchFamily();
      setProfiles(data.profiles);
      setSharedWith(data.sharedWith);
    } catch (err) {
      console.warn('Failed to load family', err.message);
    }
  }, []);

  useEffect(() => {
    load();
    fetchSupportedLanguages()
      .then((data) => setLanguages(data.languages.map((l) => ({ value: l.code, label: l.name }))))
      .catch(() => {});
  }, [load]);

  async function handleAdd() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { profile } = await createFamilyMember(name.trim(), relation);
      setName('');
      const data = await fetchFamily();
      setProfiles(data.profiles);
      const created = data.profiles.find((p) => p.id === profile.id);
      showAlert(t('family.addedTitle', { name: profile.displayName }), t('family.addedMessage'), [
        { text: t('family.later'), style: 'cancel' },
        { text: t('family.openProfile', { name: profile.displayName }), onPress: () => openProfile(created) },
      ]);
    } catch (err) {
      showAlert(t('family.couldNotSave'), err.message);
    } finally {
      setBusy(false);
    }
  }

  async function shareCode(profile, access) {
    try {
      const { invite } = await createFamilyInvite({ profileId: profile.isSelf ? undefined : profile.id, access });
      const whose = profile.isSelf ? t('family.myHealthShort') : profile.displayName;
      const message = t('family.inviteMessage', { name: whose, code: invite.code });
      try {
        await Share.share({ message });
      } catch {
        showAlert(t('family.inviteCodeTitle'), message);
      }
    } catch (err) {
      showAlert(t('family.couldNotSave'), err.message);
    }
  }

  function handleRemove(profile) {
    const message = profile.isManaged ? t('family.removeManagedMessage') : t('family.removeLinkedMessage');
    showAlert(t('family.removeTitle', { name: profile.displayName }), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('family.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeFamilyMember(profile.id);
            if (activeProfile?.id === profile.id) switchProfile(null);
            await load();
          } catch (err) {
            showAlert(t('family.couldNotSave'), err.message);
          }
        },
      },
    ]);
  }

  async function handleLanguage(profile, languageCode) {
    setProfiles((current) => current.map((p) => (p.id === profile.id ? { ...p, preferredLanguage: languageCode } : p)));
    try {
      await updateFamilyMember(profile.id, { preferredLanguage: languageCode });
    } catch (err) {
      showAlert(t('family.couldNotSave'), err.message);
      load();
    }
  }

  async function handleRedeem() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const { profile } = await redeemFamilyInvite(code.trim());
      setCode('');
      await load();
      if (profile) showAlert(t('family.joinedTitle', { name: profile.displayName }), t('family.joinedMessage'));
    } catch (err) {
      showAlert(t('family.couldNotJoin'), err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleRevoke(person) {
    showAlert(t('family.revokeTitle', { name: person.displayName || person.email || '' }), t('family.revokeMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('family.revoke'),
        style: 'destructive',
        onPress: async () => {
          try {
            await revokeFamilyAccess(person.id);
            await load();
          } catch (err) {
            showAlert(t('family.couldNotSave'), err.message);
          }
        },
      },
    ]);
  }

  const activeId = activeProfile?.id;

  // Land on the Dashboard of whoever was picked - the navigator remounts
  // for the new profile, so leave this screen first.
  function openProfile(profile) {
    const next = profile && !profile.isSelf ? profile : null;
    if ((next?.id || null) === (activeId || null)) return;
    navigation.popToTop();
    setTimeout(() => switchProfile(next), 0);
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.bodySecondary}>{t('family.intro')}</Text>

        {profiles.map((profile) => (
          <ProfileRow
            key={profile.id}
            profile={profile}
            active={profile.isSelf ? !activeId : profile.id === activeId}
            languages={languages}
            t={t}
            onSwitch={openProfile}
            onShare={shareCode}
            onRemove={handleRemove}
            onLanguage={handleLanguage}
          />
        ))}

        <Text style={[typography.heading, styles.sectionTitle]}>{t('family.addTitle')}</Text>
        <View style={[styles.card, cardShadow]}>
          <Text style={typography.caption}>{t('family.addHint')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('family.namePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            maxLength={60}
          />
          <ChipSelect
            options={RELATIONS.map((r) => ({ value: r, label: t(`family.relation.${r}`) }))}
            value={relation}
            onChange={setRelation}
            allowClear={false}
          />
          <PrimaryButton title={t('family.addButton')} onPress={handleAdd} disabled={!name.trim()} loading={busy} />
        </View>

        <Text style={[typography.heading, styles.sectionTitle]}>{t('family.joinTitle')}</Text>
        <View style={[styles.card, cardShadow]}>
          <Text style={typography.caption}>{t('family.joinHint')}</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            placeholder="ABCD2345"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />
          <PrimaryButton title={t('family.joinButton')} onPress={handleRedeem} disabled={!code.trim()} loading={busy} variant="secondary" />
        </View>

        <Text style={[typography.heading, styles.sectionTitle]}>{t('family.sharedWithTitle')}</Text>
        {sharedWith.length === 0 ? (
          <Text style={typography.bodySecondary}>{t('family.sharedWithEmpty')}</Text>
        ) : (
          sharedWith.map((person) => (
            <View key={person.id} style={[styles.card, cardShadow, styles.sharedRow]}>
              <View style={styles.profileText}>
                <Text style={typography.body}>{person.displayName || person.email || t('family.someone')}</Text>
                <Text style={typography.caption}>{person.access === 'view' ? t('family.viewOnly') : t('family.canManage')}</Text>
              </View>
              <TouchableOpacity onPress={() => handleRevoke(person)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.actionLabel, styles.dangerLabel]}>{t('family.revoke')}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardActive: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActive: {
    backgroundColor: colors.primary,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  avatarTextActive: {
    color: colors.onBrand,
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  switchLabelActive: {
    color: colors.success,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  dangerLabel: {
    color: colors.danger,
  },
  sectionTitle: {
    marginTop: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  codeInput: {
    letterSpacing: 2,
    fontWeight: '700',
  },
  sharePanel: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
