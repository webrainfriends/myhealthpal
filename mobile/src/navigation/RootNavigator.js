import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/DashboardScreen';
import TimelineScreen from '../screens/TimelineScreen';
import UploadScreen from '../screens/UploadScreen';
import ReportDetailScreen from '../screens/ReportDetailScreen';
import ParameterTrendScreen from '../screens/ParameterTrendScreen';
import InsightsScreen from '../screens/InsightsScreen';
import ChatScreen from '../screens/ChatScreen';
import { colors } from '../theme/theme';

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.primary,
  },
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
      }}
    >
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: 'Dashboard', headerShown: false }} />
      <Tab.Screen name="TimelineTab" component={TimelineScreen} options={{ title: 'Timeline', headerShown: false }} />
      <Tab.Screen name="ChatTab" component={ChatScreen} options={{ title: 'Ask', headerShown: false }} />
      <Tab.Screen name="UploadTab" component={UploadScreen} options={{ title: 'Upload', headerShown: false }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="ReportDetail" component={ReportDetailScreen} options={{ title: 'Report' }} />
        <Stack.Screen name="ParameterTrend" component={ParameterTrendScreen} options={{ title: 'Trend' }} />
        <Stack.Screen name="Insights" component={InsightsScreen} options={{ title: 'AI insights' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
