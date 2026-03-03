import * as React from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from '@app/utils/apiClient';
import { notifyApiError, notifySuccess } from '@app/utils/notifications';
import {
  Alert,
  Button,
  Checkbox,
  Content,
  ContentVariants,
  EmptyState,
  EmptyStateBody,
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalHeader,
  Skeleton,
  TextInput,
  Tooltip,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { BellIcon, PencilAltIcon, TrashIcon } from '@patternfly/react-icons';

interface NotificationEntry {
  id?: string;
  endpoint: string;
  events: string[];
  prefix?: string;
  suffix?: string;
}

interface BucketNotificationsModalProps {
  bucketName: string;
  isOpen: boolean;
  onClose: () => void;
}

const BucketNotificationsModal: React.FunctionComponent<BucketNotificationsModalProps> = ({
  bucketName,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation(['buckets', 'translation']);

  // Notification list state
  const [notifications, setNotifications] = React.useState<NotificationEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  // Add form state
  const [endpoint, setEndpoint] = React.useState('');
  const [objectCreated, setObjectCreated] = React.useState(true);
  const [objectRemoved, setObjectRemoved] = React.useState(true);
  const [prefix, setPrefix] = React.useState('');
  const [suffix, setSuffix] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [isFormExpanded, setIsFormExpanded] = React.useState(false);
  const [editingNotificationId, setEditingNotificationId] = React.useState<string | null>(null);
  const isEditMode = editingNotificationId !== null;

  const loadNotifications = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.get(`/notifications/${bucketName}`);
      setNotifications(response.data.notifications || []);
    } catch (error) {
      notifyApiError(t('notifications.error.loadFailed'), error);
    } finally {
      setIsLoading(false);
    }
  }, [bucketName, t]);

  // Load notifications when modal opens
  React.useEffect(() => {
    if (isOpen && bucketName) {
      loadNotifications();
    }
  }, [isOpen, bucketName, loadNotifications]);

  const resetForm = () => {
    setEndpoint('');
    setObjectCreated(true);
    setObjectRemoved(true);
    setPrefix('');
    setSuffix('');
    setTestResult(null);
    setEditingNotificationId(null);
  };

  const handleClose = () => {
    resetForm();
    setIsFormExpanded(false);
    onClose();
  };

  const validateForm = (): boolean => {
    if (!endpoint.trim()) return false;
    if (!/^https?:\/\/.+/.test(endpoint)) return false;
    if (!objectCreated && !objectRemoved) return false;
    return true;
  };

  const handleEditClick = (entry: NotificationEntry) => {
    setEndpoint(entry.endpoint);
    setObjectCreated(entry.events.includes('s3:ObjectCreated:*'));
    setObjectRemoved(entry.events.includes('s3:ObjectRemoved:*'));
    setPrefix(entry.prefix || '');
    setSuffix(entry.suffix || '');
    setTestResult(null);
    setEditingNotificationId(entry.id || null);
    setIsFormExpanded(true);
  };

  const handleCancelEdit = () => {
    resetForm();
    setIsFormExpanded(false);
  };

  const handleSaveNotification = async () => {
    if (!validateForm()) return;

    const events: string[] = [];
    if (objectCreated) events.push('s3:ObjectCreated:*');
    if (objectRemoved) events.push('s3:ObjectRemoved:*');

    let updatedNotifications: NotificationEntry[];

    if (isEditMode) {
      updatedNotifications = notifications.map((n) =>
        n.id === editingNotificationId
          ? { ...n, endpoint, events, prefix: prefix || undefined, suffix: suffix || undefined }
          : n,
      );
    } else {
      const newEntry: NotificationEntry = {
        endpoint,
        events,
        prefix: prefix || undefined,
        suffix: suffix || undefined,
      };
      updatedNotifications = [...notifications, newEntry];
    }

    setIsSaving(true);
    try {
      await apiClient.put(`/notifications/${bucketName}`, {
        notifications: updatedNotifications,
      });
      if (isEditMode) {
        notifySuccess(t('notifications.success.updated'), t('notifications.success.updatedMessage'));
      } else {
        notifySuccess(t('notifications.success.created'), t('notifications.success.createdMessage'));
      }
      resetForm();
      setIsFormExpanded(false);
      await loadNotifications();
    } catch (error) {
      notifyApiError(t('notifications.error.saveFailed'), error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    try {
      await apiClient.delete(`/notifications/${bucketName}/${notificationId}`);
      notifySuccess(t('notifications.success.deleted'), t('notifications.success.deletedMessage'));
      if (editingNotificationId === notificationId) {
        resetForm();
        setIsFormExpanded(false);
      }
      await loadNotifications();
    } catch (error) {
      notifyApiError(t('notifications.error.deleteFailed'), error);
    }
  };

  const handleTestEndpoint = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await apiClient.post('/notifications/test-endpoint', {
        endpoint,
      });
      setTestResult({
        success: true,
        message: t('notifications.success.testSuccessMessage', {
          statusCode: response.data.statusCode,
        }),
      });
    } catch (error: unknown) {
      const errMsg =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Unknown error'
          : error instanceof Error
            ? error.message
            : 'Unknown error';
      setTestResult({
        success: false,
        message: t('notifications.error.testFailedMessage', { message: errMsg }),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const formatEvents = (events: string[]): string => {
    return events
      .map((e) => {
        if (e === 's3:ObjectCreated:*') return t('notifications.form.objectCreated');
        if (e === 's3:ObjectRemoved:*') return t('notifications.form.objectRemoved');
        return e;
      })
      .join(', ');
  };

  const formatFilters = (entry: NotificationEntry): string => {
    const parts: string[] = [];
    if (entry.prefix) parts.push(`prefix: ${entry.prefix}`);
    if (entry.suffix) parts.push(`suffix: ${entry.suffix}`);
    return parts.length > 0 ? parts.join(', ') : '-';
  };

  return (
    <Modal
      className="standard-modal"
      isOpen={isOpen}
      onClose={handleClose}
      aria-labelledby="bucket-notifications-modal-title"
      variant="large"
    >
      <ModalHeader
        labelId="bucket-notifications-modal-title"
        title={t('notifications.title')}
        description={`${bucketName} - ${t('notifications.description')}`}
      />
      <ModalBody>
        {/* Notification list */}
        {isLoading ? (
          <>
            <Skeleton width="100%" screenreaderText={t('translation:common.actions.loading')} />
            <br />
            <Skeleton width="100%" screenreaderText={t('translation:common.actions.loading')} />
          </>
        ) : notifications.length === 0 ? (
          <EmptyState headingLevel="h4" icon={BellIcon} titleText={t('notifications.emptyState.title')}>
            <EmptyStateBody>{t('notifications.emptyState.description')}</EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label={t('notifications.title')} variant="compact">
            <Thead>
              <Tr>
                <Th>{t('notifications.table.endpoint')}</Th>
                <Th>{t('notifications.table.events')}</Th>
                <Th>{t('notifications.table.filters')}</Th>
                <Th screenReaderText={t('notifications.table.actions')} />
              </Tr>
            </Thead>
            <Tbody>
              {notifications.map((entry, index) => (
                <Tr key={entry.id || index}>
                  <Td dataLabel={t('notifications.table.endpoint')}>
                    <Content component={ContentVariants.small} style={{ wordBreak: 'break-all' }}>
                      {entry.endpoint}
                    </Content>
                  </Td>
                  <Td dataLabel={t('notifications.table.events')}>{formatEvents(entry.events)}</Td>
                  <Td dataLabel={t('notifications.table.filters')}>{formatFilters(entry)}</Td>
                  <Td>
                    {entry.id && (
                      <div style={{ display: 'flex', gap: 'var(--pf-t--global--spacer--xs)' }}>
                        <Tooltip content={<div>{t('tooltips.editNotification')}</div>}>
                          <Button
                            variant="plain"
                            aria-label={t('notifications.form.editTitle')}
                            onClick={() => handleEditClick(entry)}
                          >
                            <PencilAltIcon />
                          </Button>
                        </Tooltip>
                        <Tooltip content={<div>{t('tooltips.deleteNotification')}</div>}>
                          <Button
                            variant="plain"
                            aria-label={t('translation:common.actions.delete')}
                            onClick={() => handleDeleteNotification(entry.id as string)}
                          >
                            <TrashIcon />
                          </Button>
                        </Tooltip>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}

        {/* Add notification form */}
        <ExpandableSection
          toggleText={isEditMode ? t('notifications.form.editTitle') : t('notifications.form.addTitle')}
          isExpanded={isFormExpanded}
          onToggle={(_event, expanded) => {
            if (!expanded) {
              resetForm();
            }
            setIsFormExpanded(expanded);
          }}
          className="pf-u-margin-top-md"
        >
          <Form>
            <FormGroup label={t('notifications.form.endpointLabel')} isRequired fieldId="notification-endpoint">
              <TextInput
                isRequired
                type="url"
                id="notification-endpoint"
                placeholder={t('notifications.form.endpointPlaceholder')}
                value={endpoint}
                onChange={(_event, value) => setEndpoint(value)}
                validated={endpoint && !/^https?:\/\/.+/.test(endpoint) ? 'error' : 'default'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {endpoint && !/^https?:\/\/.+/.test(endpoint)
                      ? t('notifications.error.endpointInvalid')
                      : t('notifications.form.endpointHelperText')}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>

            <FormGroup label={t('notifications.form.eventsLabel')} isRequired fieldId="notification-events">
              <Checkbox
                label={t('notifications.form.objectCreated')}
                id="event-object-created"
                isChecked={objectCreated}
                onChange={(_event, checked) => setObjectCreated(checked)}
              />
              <Checkbox
                label={t('notifications.form.objectRemoved')}
                id="event-object-removed"
                isChecked={objectRemoved}
                onChange={(_event, checked) => setObjectRemoved(checked)}
              />
              {!objectCreated && !objectRemoved && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem variant="error">{t('notifications.error.eventsRequired')}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>

            <FormGroup label={t('notifications.form.prefixLabel')} fieldId="notification-prefix">
              <TextInput
                type="text"
                id="notification-prefix"
                placeholder={t('notifications.form.prefixPlaceholder')}
                value={prefix}
                onChange={(_event, value) => setPrefix(value)}
              />
            </FormGroup>

            <FormGroup label={t('notifications.form.suffixLabel')} fieldId="notification-suffix">
              <TextInput
                type="text"
                id="notification-suffix"
                placeholder={t('notifications.form.suffixPlaceholder')}
                value={suffix}
                onChange={(_event, value) => setSuffix(value)}
              />
            </FormGroup>

            {testResult && (
              <Alert
                variant={testResult.success ? 'success' : 'danger'}
                title={
                  testResult.success ? t('notifications.success.testSuccess') : t('notifications.error.testFailed')
                }
                isInline
              >
                {testResult.message}
              </Alert>
            )}

            <div className="pf-v6-l-flex" style={{ gap: 'var(--pf-t--global--spacer--sm)' }}>
              <Button
                variant="secondary"
                onClick={handleTestEndpoint}
                isLoading={isTesting}
                isDisabled={!endpoint || !/^https?:\/\/.+/.test(endpoint) || isTesting}
              >
                {t('notifications.form.testButton')}
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveNotification}
                isLoading={isSaving}
                isDisabled={!validateForm() || isSaving}
              >
                {isEditMode ? t('notifications.form.saveButton') : t('notifications.form.addButton')}
              </Button>
              {isEditMode && (
                <Button variant="link" onClick={handleCancelEdit}>
                  {t('notifications.form.cancelButton')}
                </Button>
              )}
            </div>
          </Form>
        </ExpandableSection>
      </ModalBody>
    </Modal>
  );
};

export default BucketNotificationsModal;
