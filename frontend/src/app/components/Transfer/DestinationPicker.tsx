import {
  Breadcrumb,
  BreadcrumbItem,
  Button,
  DataList,
  DataListCell,
  DataListItem,
  DataListItemCells,
  DataListItemRow,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import { FolderIcon, PlusIcon } from '@patternfly/react-icons';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { FileEntry, storageService } from '@app/services/storageService';
import { notifyError, notifySuccess } from '@app/utils/notifications';
import { getFolderNameRules, validateS3ObjectName } from '@app/utils/validation';
import { useStorageLocations } from '@app/hooks';

interface DestinationPickerProps {
  isOpen: boolean;
  onSelect: (locationId: string, path: string) => void;
  onCancel: () => void;
}

export const DestinationPicker: React.FC<DestinationPickerProps> = ({ isOpen, onSelect, onCancel }) => {
  const { t } = useTranslation('transfer');
  // Suppress notifications - this modal only appears when user is already browsing storage
  const { locations } = useStorageLocations({ suppressNotifications: true });
  const [selectedLocation, setSelectedLocation] = React.useState<string>('');
  const [currentPath, setCurrentPath] = React.useState<string>('');
  const [directories, setDirectories] = React.useState<FileEntry[]>([]);

  // Folder creation modal state
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');
  const [newFolderNameRulesVisibility, setNewFolderNameRulesVisibility] = React.useState(false);

  // Note: Storage locations are loaded by useStorageLocations hook

  // Load directories when location or path changes
  React.useEffect(() => {
    if (selectedLocation) {
      storageService
        .listFiles(selectedLocation, currentPath)
        .then(({ files }) => {
          setDirectories(files.filter((f) => f.type === 'directory'));
        })
        .catch((error: unknown) => {
          console.error('Failed to list directories:', error);
          const message = error instanceof Error ? error.message : 'Unknown error';
          notifyError(t('destination.loadError'), message);
        });
    }
  }, [selectedLocation, currentPath, t]);

  // Folder name validation using centralized utility
  const validateFolderName = (folderName: string, storageType?: 's3' | 'local'): boolean => {
    return validateS3ObjectName(folderName, storageType);
  };

  // Real-time validation feedback for folder name - only show rules on validation failure
  React.useEffect(() => {
    if (newFolderName.length > 0) {
      const location = locations.find((loc) => loc.id === selectedLocation);
      setNewFolderNameRulesVisibility(!validateFolderName(newFolderName, location?.type));
    } else {
      setNewFolderNameRulesVisibility(false);
    }
  }, [newFolderName, selectedLocation, locations]);

  const handleNavigateInto = (dir: FileEntry) => {
    setCurrentPath(dir.path);
  };

  const handleBreadcrumbClick = (path: string) => {
    setCurrentPath(path);
  };

  // Open create folder modal
  const handleCreateFolder = () => {
    setIsCreateFolderModalOpen(true);
  };

  // Handle folder creation confirmation
  const handleCreateFolderConfirm = async () => {
    const location = locations.find((loc) => loc.id === selectedLocation);
    if (!validateFolderName(newFolderName, location?.type)) {
      return;
    }

    const newPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;

    try {
      await storageService.createDirectory(selectedLocation, newPath);

      // Refresh directory list
      const { files } = await storageService.listFiles(selectedLocation, currentPath);
      setDirectories(files.filter((f) => f.type === 'directory'));

      notifySuccess(
        t('destination.notifications.folderCreated.title'),
        t('destination.notifications.folderCreated.message', { name: newFolderName }),
      );

      // Close modal and reset state
      setNewFolderName('');
      setIsCreateFolderModalOpen(false);
    } catch (error: unknown) {
      console.error('Failed to create folder:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      notifyError(t('destination.notifications.folderCreateError'), message);
    }
  };

  // Cancel folder creation
  const handleCreateFolderCancel = () => {
    setNewFolderName('');
    setIsCreateFolderModalOpen(false);
  };

  return (
    <>
      <Modal
        className="standard-modal"
        isOpen={isOpen}
        onClose={onCancel}
        aria-labelledby="destination-picker-modal-title"
      >
        <ModalHeader labelId="destination-picker-modal-title" title={t('destination.title')} />
        <ModalBody>
          <Form>
            <FormGroup label={t('destination.location')} isRequired>
              <FormSelect
                id="destination-location-select"
                aria-label={t('destination.selectLocation')}
                value={selectedLocation}
                onChange={(_event, value) => {
                  setSelectedLocation(value as string);
                  setCurrentPath('');
                }}
              >
                <FormSelectOption value="" label={t('destination.selectLocationPlaceholder')} isDisabled />
                {locations.map((loc) => (
                  <FormSelectOption
                    key={loc.id}
                    value={loc.id}
                    label={`${loc.name} (${loc.type.toUpperCase()})${!loc.available ? t('destination.unavailable') : ''}`}
                    isDisabled={!loc.available}
                  />
                ))}
              </FormSelect>
            </FormGroup>

            {selectedLocation && (
              <>
                <Breadcrumb>
                  <BreadcrumbItem>
                    <Button
                      variant="link"
                      className="breadcrumb-button"
                      onClick={() => handleBreadcrumbClick('')}
                      aria-label={t('destination.root')}
                    >
                      {t('destination.root')}
                    </Button>
                  </BreadcrumbItem>
                  {(currentPath.endsWith('/') ? currentPath.slice(0, -1) : currentPath)
                    .split('/')
                    .filter(Boolean)
                    .map((segment, i, segments) => (
                      <BreadcrumbItem key={i}>
                        <Button
                          variant="link"
                          className="breadcrumb-button"
                          onClick={() => handleBreadcrumbClick(segments.slice(0, i + 1).join('/') + '/')}
                          aria-label={segment}
                        >
                          {segment}
                        </Button>
                      </BreadcrumbItem>
                    ))}
                </Breadcrumb>

                <DataList aria-label={t('destination.directoryList')}>
                  {directories.map((dir) => (
                    <DataListItem key={dir.path}>
                      <DataListItemRow>
                        <DataListItemCells
                          dataListCells={[
                            <DataListCell key="name">
                              <Button
                                variant="link"
                                onClick={() => handleNavigateInto(dir)}
                                className="button-folder-link"
                              >
                                <FolderIcon /> {dir.name}
                              </Button>
                            </DataListCell>,
                          ]}
                        />
                      </DataListItemRow>
                    </DataListItem>
                  ))}
                </DataList>

                <Button variant="secondary" onClick={handleCreateFolder} icon={<PlusIcon />}>
                  {t('destination.createFolder')}
                </Button>
              </>
            )}
          </Form>
        </ModalBody>

        <ModalFooter>
          <Button
            key="select"
            variant="primary"
            onClick={() => onSelect(selectedLocation, currentPath)}
            isDisabled={!selectedLocation}
          >
            {t('destination.selectDestination')}
          </Button>
          <Button key="cancel" variant="link" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Create Folder Modal */}
      <Modal
        className="standard-modal"
        isOpen={isCreateFolderModalOpen}
        onClose={handleCreateFolderCancel}
        variant="small"
        aria-labelledby="dest-create-folder-modal-title"
      >
        <ModalHeader labelId="dest-create-folder-modal-title" title={t('destination.newFolder.title')} />
        <ModalBody>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              if (newFolderName.length > 0 && !newFolderNameRulesVisibility) {
                handleCreateFolderConfirm();
              }
            }}
          >
            <FormGroup label={t('destination.newFolder.label')} isRequired fieldId="folder-name">
              <TextInput
                isRequired
                type="text"
                id="folder-name"
                name="folder-name"
                aria-describedby="folder-name-helper"
                placeholder={t('destination.newFolder.placeholder')}
                value={newFolderName}
                onChange={(_event, newFolderName) => setNewFolderName(newFolderName)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (newFolderName.length > 0 && !newFolderNameRulesVisibility) {
                      handleCreateFolderConfirm();
                    }
                  }
                }}
                validated={newFolderNameRulesVisibility ? 'error' : 'default'}
              />
              {newFolderNameRulesVisibility && (
                <FormHelperText>
                  <HelperText id="folder-name-helper">
                    <HelperTextItem
                      variant={
                        newFolderName.length > 0 &&
                        !validateFolderName(newFolderName, locations.find((loc) => loc.id === selectedLocation)?.type)
                          ? 'error'
                          : 'indeterminate'
                      }
                    >
                      {t('destination.newFolder.rulesTitle')}
                      <ul>
                        {getFolderNameRules(locations.find((loc) => loc.id === selectedLocation)?.type).map(
                          (rule, index) => (
                            <li key={index}>{rule}</li>
                          ),
                        )}
                      </ul>
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button
            key="create"
            variant="primary"
            onClick={handleCreateFolderConfirm}
            isDisabled={newFolderName.length < 1 || newFolderNameRulesVisibility}
          >
            {t('destination.create')}
          </Button>
          <Button key="cancel" variant="link" onClick={handleCreateFolderCancel}>
            {t('actions.cancel')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};
