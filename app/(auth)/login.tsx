import { supabase } from '@/lib/supabase';
import { officeSitePage } from '@/lib/config';
import { useState } from 'react';
import { View, Text, Image, StyleSheet, KeyboardAvoidingView, Platform, type TextStyle, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EnvironmentLabel } from '@/components/ui/EnvironmentLabel';
import { colors, radius, space, fontSize, fontWeight, shadow } from '@/lib/design/tokens';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const signIn = useAuthStore((s) => s.signIn);

  const resetPassword = async () => {
    if (!email.trim()) { setError('Enter your email to request a password reset.'); return; }
    // The reset page is on this environment's office site.
    const resetPage = officeSitePage('login.html');
    if (!resetPage) { setError('Password reset is not available in this version of the app. Ask your administrator to reset your password.'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: resetPage,
      });
      if (error) throw error;
      setNotice('If this account can receive a reset link, check your email to set a new password.');
    } catch (e: any) { setError(e.message || 'Could not request a reset. Please retry.'); }
    finally { setLoading(false); }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    const { error: signInError } = await signIn(email, password);

    if (signInError) {
      setError(signInError);
      setLoading(false);
      return;
    }

    setLoading(false);
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={styles.form}>
          <View style={styles.head}>
            <Image
              source={require('@/assets/images/invenio-technologies-logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Invenio Technologies"
            />
            <Text style={styles.title} accessibilityRole="header">Sign in</Text>
            <Text style={styles.subtitle}>Laydown yard management</Text>
            <EnvironmentLabel variant="pill" />
          </View>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@company.com"
            required
            error={error && !email.trim() ? 'Email is required' : undefined}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Enter password"
            required
            error={error && !password ? 'Password is required' : undefined}
          />

          {error ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textMuted }}>{notice}</Text> : null}
          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            style={{ marginTop: space[2] }}
          />
          <Button title="Forgot password?" variant="ghost" onPress={resetPassword} disabled={loading} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Portal sign-in: card centered on the navy-to-blue gradient. Native
  // falls back to the navy start color (no gradient dependency).
  container: {
    flex: 1,
    backgroundColor: colors.heroStart,
    ...(Platform.OS === 'web'
      ? ({ backgroundImage: `linear-gradient(135deg, ${colors.heroStart} 0%, ${colors.heroEnd} 100%)` } as unknown as ViewStyle)
      : {}),
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  head: {
    alignItems: 'center',
    paddingBottom: space[4],
    marginBottom: space[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logo: {
    width: 141,
    height: 48,
    marginBottom: space[3],
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold as TextStyle['fontWeight'],
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  form: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[6],
    ...shadow.lg,
  },
  formError: {
    color: colors.danger,
    fontSize: fontSize.body,
    textAlign: 'center',
    marginBottom: space[2],
  },
});
