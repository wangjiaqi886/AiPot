import {
  Input,
  Button,
  Switch,
  Textarea,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@heroui/react'
import { INSTANCE_NAME_CONFIG_KEY } from '@/renderer/lib/service/service_instance'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useConfig } from '../../../hooks/useConfig'
import { getModels, translate } from './index'
import { Language } from './index'
import { DEFAULT_OPENAI_COMPATIBLE_BASE_URL, type PromptItem } from './translate'
import type { ServiceConfigComponentProps } from '@/renderer/windows/Config/pages/Service/types'
import ProviderConfigForm from '@/renderer/windows/Config/pages/Service/ProviderConfigForm'
import TestButton from '@/renderer/windows/Config/pages/Service/TestButton'
import InstanceNameInput from '@/renderer/windows/Config/pages/Service/InstanceNameInput'
import ConfigItem from '@/renderer/windows/Config/components/ConfigItem'
import { logger } from '@/renderer/lib/logger'

export const DEFAULT_OPENAI_PROMPT_LIST: PromptItem[] = [
  {
    role: 'system',
    content:
      'You are a professional translation engine. Translate the text the user provides into the requested language. Return only the translated text without explanations or quotes.',
  },
  { role: 'user', content: 'Translate into $to:\n\n$text' },
]

type OpenAICompatibleServiceConfig = {
  [INSTANCE_NAME_CONFIG_KEY]: string
  requestPath: string
  apiKey: string
  model: string
  stream: boolean
  temperature: string
  maxTokens: string
  requestArguments: string
  promptList: PromptItem[]
}

function normalizeServiceConfig(
  config: OpenAICompatibleServiceConfig,
  defaultName: string,
): OpenAICompatibleServiceConfig {
  return {
    ...config,
    [INSTANCE_NAME_CONFIG_KEY]: config[INSTANCE_NAME_CONFIG_KEY] || defaultName,
    requestPath: config.requestPath || DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    model: config.model ?? '',
    stream: config.stream ?? false,
    temperature: config.temperature ?? '',
    maxTokens: config.maxTokens ?? '',
    requestArguments: config.requestArguments ?? '',
    promptList:
      config.promptList && config.promptList.length > 0
        ? config.promptList
        : DEFAULT_OPENAI_PROMPT_LIST,
  }
}

export function Config(props: ServiceConfigComponentProps) {
  const { instanceKey, updateServiceList, onClose } = props
  const { t } = useTranslation()
  const defaultName = t('services.translate.openai_compatible.title')
  const [storedServiceConfig, setServiceConfig] = useConfig<OpenAICompatibleServiceConfig>(
    instanceKey,
    {
      [INSTANCE_NAME_CONFIG_KEY]: defaultName,
      requestPath: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
      apiKey: '',
      model: '',
      stream: false,
      temperature: '',
      maxTokens: '',
      requestArguments: '',
      promptList: DEFAULT_OPENAI_PROMPT_LIST,
    },
    { sync: false },
  )
  const serviceConfig =
    storedServiceConfig === null ? null : normalizeServiceConfig(storedServiceConfig, defaultName)
  const [isLoading, setIsLoading] = useState(false)
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const serviceConfigRef = useRef(serviceConfig)

  useEffect(() => {
    serviceConfigRef.current = serviceConfig
  }, [serviceConfig])

  const refreshModels = useCallback(async () => {
    const currentConfig = serviceConfigRef.current
    if (!currentConfig) {
      return
    }
    setIsFetchingModels(true)
    try {
      const models = await getModels(currentConfig.requestPath, currentConfig.apiKey)
      setModelList(models)
    } catch (error) {
      setModelList(null)
      logger.warn('OpenAI-compatible model list fetch failed.', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsFetchingModels(false)
    }
  }, [])

  const handleTest = async () => {
    if (!serviceConfig) {
      return
    }
    // Test connectivity with the configured model and endpoint.
    await translate('hello', Language.auto, Language.zh_cn, { config: serviceConfig })
  }

  return (
    serviceConfig !== null && (
      <ProviderConfigForm
        instanceKey={instanceKey}
        config={serviceConfig}
        setConfig={setServiceConfig}
        updateServiceList={updateServiceList}
        onClose={onClose}
        isLoading={isLoading}
        testButton={
          <TestButton isLoading={isLoading} setIsLoading={setIsLoading} onTest={handleTest} />
        }
      >
        <InstanceNameInput
          value={serviceConfig[INSTANCE_NAME_CONFIG_KEY]}
          onValueChange={(value) => {
            void setServiceConfig({
              ...serviceConfig,
              [INSTANCE_NAME_CONFIG_KEY]: value,
            })
          }}
        />
        <ConfigItem>
          <Input
            label={t('services.translate.openai_compatible.api_key')}
            labelPlacement="outside-left"
            type="password"
            value={serviceConfig.apiKey}
            variant="bordered"
            classNames={{
              base: 'justify-between',
              label: 'text-(length:--heroui-font-size-medium)',
              mainWrapper: 'max-w-[50%]',
            }}
            onValueChange={(value) => {
              void setServiceConfig({
                ...serviceConfig,
                apiKey: value,
              })
            }}
          />
        </ConfigItem>
        <ConfigItem>
          <Input
            label={t('services.translate.openai_compatible.request_path')}
            labelPlacement="outside-left"
            value={serviceConfig.requestPath}
            variant="bordered"
            classNames={{
              base: 'justify-between',
              label: 'text-(length:--heroui-font-size-medium)',
              mainWrapper: 'max-w-[50%]',
            }}
            onValueChange={(value) => {
              void setServiceConfig({
                ...serviceConfig,
                requestPath: value,
              })
            }}
          />
        </ConfigItem>
        <ConfigItem>
          <div className="flex w-full items-end gap-2">
            <div className="flex-1">
              <Input
                label={t('services.translate.openai_compatible.model')}
                labelPlacement="outside-left"
                value={serviceConfig.model}
                variant="bordered"
                classNames={{
                  base: 'justify-between',
                  label: 'text-(length:--heroui-font-size-medium)',
                  mainWrapper: 'max-w-[100%]',
                }}
                onValueChange={(value) => {
                  void setServiceConfig({
                    ...serviceConfig,
                    model: value,
                  })
                }}
              />
            </div>
            <Button
              size="sm"
              variant="bordered"
              isLoading={isFetchingModels}
              isDisabled={isFetchingModels}
              onPress={() => {
                void refreshModels()
              }}
            >
              {t('services.translate.openai_compatible.fetch_models')}
            </Button>
            <Dropdown>
              <DropdownTrigger>
                <Button size="sm" variant="flat" isDisabled={(modelList ?? []).length === 0}>
                  {t('services.translate.openai_compatible.model_list')}
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label={t('services.translate.openai_compatible.model_list')}
                className="max-h-[40vh] overflow-y-auto"
                onAction={(key) => {
                  void setServiceConfig({
                    ...serviceConfig,
                    model: String(key),
                  })
                }}
              >
                {(modelList ?? []).map((model) => (
                  <DropdownItem key={model}>{model}</DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>
          </div>
        </ConfigItem>
        <ConfigItem>
          <Switch
            isSelected={serviceConfig.stream}
            onValueChange={(value) => {
              void setServiceConfig({
                ...serviceConfig,
                stream: value,
              })
            }}
            classNames={{
              base: 'flex flex-row-reverse justify-between w-full max-w-full',
            }}
          >
            {t('services.translate.openai_compatible.stream')}
          </Switch>
        </ConfigItem>
        <h3 className="my-auto">{t('services.translate.openai_compatible.model_config')}</h3>
        <ConfigItem>
          <Input
            label={t('services.translate.openai_compatible.temperature')}
            labelPlacement="outside-left"
            type="number"
            step="any"
            value={serviceConfig.temperature}
            placeholder={t('services.translate.openai_compatible.use_model_default')}
            variant="bordered"
            classNames={{
              base: 'justify-between',
              label: 'text-(length:--heroui-font-size-medium)',
              mainWrapper: 'max-w-[50%]',
            }}
            onValueChange={(value) => {
              void setServiceConfig({
                ...serviceConfig,
                temperature: value,
              })
            }}
          />
        </ConfigItem>
        <ConfigItem>
          <Input
            label={t('services.translate.openai_compatible.max_tokens')}
            labelPlacement="outside-left"
            type="number"
            step="1"
            value={serviceConfig.maxTokens}
            placeholder={t('services.translate.openai_compatible.use_model_default')}
            variant="bordered"
            classNames={{
              base: 'justify-between',
              label: 'text-(length:--heroui-font-size-medium)',
              mainWrapper: 'max-w-[50%]',
            }}
            onValueChange={(value) => {
              void setServiceConfig({
                ...serviceConfig,
                maxTokens: value,
              })
            }}
          />
        </ConfigItem>
        <ConfigItem>
          <Input
            label={t('services.translate.openai_compatible.request_arguments')}
            labelPlacement="outside-left"
            value={serviceConfig.requestArguments}
            placeholder='e.g. {"top_p": 0.9}'
            variant="bordered"
            classNames={{
              base: 'justify-between',
              label: 'text-(length:--heroui-font-size-medium)',
              mainWrapper: 'max-w-[50%]',
            }}
            onValueChange={(value) => {
              void setServiceConfig({
                ...serviceConfig,
                requestArguments: value,
              })
            }}
          />
        </ConfigItem>
        <h3 className="my-auto">{t('services.translate.openai_compatible.prompt_list')}</h3>
        <p className="text-[10px] text-default-700">
          {t('services.translate.openai_compatible.prompt_description')}
        </p>
        <div className="bg-content2 rounded-[10px] p-3">
          {serviceConfig.promptList.map((prompt, index) => {
            return (
              <ConfigItem key={`${prompt.role}-${index}`}>
                <Textarea
                  label={prompt.role}
                  labelPlacement="outside"
                  variant="faded"
                  value={prompt.content}
                  onValueChange={(value) => {
                    void setServiceConfig({
                      ...serviceConfig,
                      promptList: serviceConfig.promptList.map((p, i) =>
                        i === index
                          ? {
                              role: i === 0 ? 'system' : index % 2 !== 0 ? 'user' : 'assistant',
                              content: value,
                            }
                          : p,
                      ),
                    })
                  }}
                />
                {serviceConfig.promptList.length > 1 && (
                  <Button
                    isIconOnly
                    color="danger"
                    className="my-auto mx-1"
                    variant="flat"
                    onPress={() => {
                      void setServiceConfig({
                        ...serviceConfig,
                        promptList: serviceConfig.promptList.filter((_, i) => i !== index),
                      })
                    }}
                  >
                    <span className="text-[18px]">×</span>
                  </Button>
                )}
              </ConfigItem>
            )
          })}
          <Button
            fullWidth
            onPress={() => {
              void setServiceConfig({
                ...serviceConfig,
                promptList: [
                  ...serviceConfig.promptList,
                  {
                    role:
                      serviceConfig.promptList.length === 0
                        ? 'system'
                        : serviceConfig.promptList.length % 2 === 0
                          ? 'assistant'
                          : 'user',
                    content: '',
                  },
                ],
              })
            }}
          >
            {t('services.translate.openai_compatible.add_prompt')}
          </Button>
        </div>
        <br />
      </ProviderConfigForm>
    )
  )
}
