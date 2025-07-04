import request from '@/services/request';
import useSessionStore from '@/stores/session';
import { ApiResp } from '@/types';
import {
  Image,
  Input,
  InputGroup,
  InputLeftAddon,
  InputRightAddon,
  Link,
  Text
} from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import NextLink from 'next/link';
import { useRouter } from 'next/router';
import { MouseEvent, MouseEventHandler, useCallback, useEffect, useRef, useState } from 'react';
import { get, useForm } from 'react-hook-form';
import { getRegionToken } from '@/api/auth';
import { getAdClickData, getInviterId, getUserSemData, sessionConfig } from '@/utils/sessionConfig';
import { I18nCommonKey } from '@/types/i18next';
import { useConfigStore } from '@/stores/config';
import useSmsStateStore from '@/stores/captcha';

export default function useSms({
  showError,
  invokeCaptcha
}: {
  showError: (errorMessage: I18nCommonKey, duration?: number) => void;
  invokeCaptcha: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { authConfig } = useConfigStore();
  const [isLoading, setIsLoading] = useState(false);
  const setToken = useSessionStore((s) => s.setToken);
  const { register, handleSubmit, trigger, getValues, watch } = useForm<{
    phoneNumber: string;
    verifyCode: string;
    inviterId?: string;
  }>();

  const login = async () => {
    const deepSearch = (obj: any): I18nCommonKey => {
      if (!obj || typeof obj !== 'object') return 'submit_error';
      if (!!obj.message) {
        return obj.message;
      }
      return deepSearch(Object.values(obj)[0]);
    };

    await handleSubmit(
      async (data) => {
        try {
          setIsLoading(true);
          const result1 = await request.post<any, ApiResp<{ token: string }>>(
            '/api/auth/phone/verify',
            {
              id: data.phoneNumber,
              code: data.verifyCode,
              inviterId: data?.inviterId || getInviterId(),
              semData: getUserSemData(),
              adClickData: getAdClickData()
            }
          );
          const globalToken = result1?.data?.token;
          if (!globalToken) throw Error();
          setToken(globalToken);
          const regionTokenRes = await getRegionToken();
          if (regionTokenRes?.data) {
            await sessionConfig(regionTokenRes.data);
            await router.replace('/');
          }
        } catch (error) {
          showError(t('common:invalid_verification_code') || 'Invalid verification code');
        } finally {
          setIsLoading(false);
        }
      },
      (err) => {
        showError(deepSearch(err));
      }
    )();
  };

  const SmsModal = ({
    onAfterGetCode,
    getCfToken,
    invokeCaptcha
  }: {
    // for cloudflare
    getCfToken?: () => Promise<string | undefined>;
    onAfterGetCode?: () => void;
    // for ali captcha
    invokeCaptcha?: () => void;
  }) => {
    const { remainTime, setRemainTime, setPhoneNumber } = useSmsStateStore();
    useEffect(() => {
      if (remainTime <= 0) return;
      const interval = setInterval(() => {
        setRemainTime(remainTime - 1);
      }, 1000);
      return () => clearInterval(interval);
    }, [remainTime]);
    const [invokeTime, setInvokeTime] = useState(new Date().getTime() - 1000);
    const getCode: MouseEventHandler = async (e: MouseEvent) => {
      e.preventDefault();
      if (!(await trigger('phoneNumber'))) {
        showError(t('common:invalid_phone_number') || 'Invalid phone number');
        return;
      }
      // throttle
      if (new Date().getTime() - invokeTime <= 1000) {
        return;
      } else {
        setInvokeTime(new Date().getTime());
      }

      const phoneNumber = getValues('phoneNumber');
      if (authConfig?.captcha.enabled && authConfig.captcha.ali.enabled) {
        setPhoneNumber(phoneNumber);
        invokeCaptcha?.();
      } else {
        // for cf ornot
        const cfToken = await getCfToken?.();
        if (authConfig?.captcha.enabled && authConfig.captcha.ali.enabled) {
          if (!cfToken) return;
        }
        setRemainTime(60);
        try {
          const res = await request.post<any, ApiResp<any>>('/api/auth/phone/sms', {
            id: phoneNumber,
            cfToken
          });
          if (res.code !== 200 || res.message !== 'successfully') {
            throw new Error('Get code failed');
          }
        } catch (err) {
          showError(t('common:get_code_failed') || 'Get code failed');
          setRemainTime(0);
        }
      }
    };
    return (
      <>
        <InputGroup
          variant={'unstyled'}
          bg="rgba(255, 255, 255, 0.65)"
          mt={'20px'}
          width="266px"
          minH="42px"
          mb="14px"
          borderRadius="4px"
          p="10px"
          border="1px solid #E5E5E5"
        >
          <InputLeftAddon>
            <Text pr={'7px'} borderRight="1px solid rgba(0, 0, 0, 0.4)">
              +86
            </Text>
          </InputLeftAddon>

          <Input
            type="tel"
            placeholder={t('common:phone_number_tips') || ''}
            mx={'12px'}
            variant={'unstyled'}
            bg={'transparent'}
            id="phoneNumber"
            fontSize="14px"
            fontWeight="400"
            _autofill={{
              bg: 'transparent'
            }}
            {...register('phoneNumber', {
              pattern: {
                value: /^1[3-9]\d{9}$/,
                message: 'Invalid mobile number'
              },
              required: 'Phone number can not be blank'
            })}
          />
          <InputRightAddon
            fontStyle="normal"
            fontWeight="500"
            fontSize="10px"
            lineHeight="20px"
            color="#219BF4"
          >
            {remainTime <= 0 ? (
              <Link as={NextLink} href="" onClick={getCode}>
                {t('common:get_code')}
              </Link>
            ) : (
              <Text>{remainTime} s</Text>
            )}
          </InputRightAddon>
        </InputGroup>

        <InputGroup
          variant={'unstyled'}
          bg="rgba(255, 255, 255, 0.65)"
          width="266px"
          minH="42px"
          mb="14px"
          borderRadius="4px"
          p="10px"
          border="1px solid #E5E5E5"
        >
          <InputLeftAddon>
            <Image src="/images/ant-design_safety-outlined.svg" alt="safety" />
          </InputLeftAddon>
          <Input
            type="text"
            placeholder={t('common:verify_code_tips') || ''}
            pl={'12px'}
            variant={'unstyled'}
            id="verifyCode"
            fontSize="14px"
            fontWeight="400"
            _autofill={{
              backgroundColor: 'transparent !important',
              backgroundImage: 'none !important'
            }}
            {...register('verifyCode', {
              required: 'verify code can not be blank',
              pattern: {
                value: /^[0-9]{6}$/,
                message: 'Invalid verification code'
              }
            })}
          />
          <InputRightAddon>
            {getValues('verifyCode')?.length === 6 && (
              <Image src="images/material-symbols_update.svg" alt="material-symbols_update" />
            )}
          </InputRightAddon>
        </InputGroup>
        {!!authConfig?.invite.enabled && (
          <InputGroup
            variant={'unstyled'}
            bg="rgba(255, 255, 255, 0.65)"
            width="266px"
            minH="42px"
            mb="14px"
            borderRadius="4px"
            p="10px"
            border="1px solid #E5E5E5"
          >
            <InputLeftAddon>
              <Image src="/icons/inviter.svg" alt="inviter" />
            </InputLeftAddon>
            <Input
              type="text"
              placeholder={t('common:inviter_id_tips') || ''}
              pl={'12px'}
              variant={'unstyled'}
              id="inviterId"
              fontSize="14px"
              fontWeight="400"
              _autofill={{
                backgroundColor: 'transparent !important',
                backgroundImage: 'none !important'
              }}
              {...register('inviterId')}
            />
          </InputGroup>
        )}
      </>
    );
  };

  return {
    SmsModal,
    login,
    isLoading
  };
}
