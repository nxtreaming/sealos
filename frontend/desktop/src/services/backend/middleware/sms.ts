import { jsonRes } from '../response';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  SmsType,
  TVerification_Codes,
  checkCode,
  checkSendable,
  deleteByUid,
  getInfoByUid
} from '../db/verifyCode';
import { isEmail } from '@/utils/crypto';
import { EMAIL_STATUS } from '@/types/response/email';
import { SemData } from '@/types/sem';
import { captchaReq } from '../sms';
import { isDisposableEmail } from 'disposable-email-domains-js';
import { createMiddleware } from '@/utils/factory';
import { HttpStatusCode } from 'axios';
import { AdClickData } from '@/types/adClick';

export const filterPhoneParams = async (
  req: NextApiRequest,
  res: NextApiResponse,
  next: (data: { phoneNumbers: string }) => void
) => {
  const { id: phoneNumbers } = req.body as { id?: string };
  if (!phoneNumbers)
    return jsonRes(res, {
      message: 'phoneNumbers is invalid',
      code: 400
    });
  await Promise.resolve(next({ phoneNumbers }));
};
export const filterEmailParams = async (
  req: NextApiRequest,
  res: NextApiResponse,
  next: (data: { email: string }) => void
) => {
  const { id: email } = req.body as { id?: string };
  if (!email || !isEmail(email) || isDisposableEmail(email))
    return jsonRes(res, {
      message: EMAIL_STATUS.INVALID_PARAMS,
      code: 400
    });
  await Promise.resolve(next({ email }));
};
export const filterPhoneVerifyParams = (
  req: NextApiRequest,
  res: NextApiResponse,
  next: (data: {
    phoneNumbers: string;
    code: string;
    inviterId?: string;
    semData?: SemData;
    adClickData?: AdClickData;
  }) => void
) =>
  filterPhoneParams(req, res, async (data) => {
    const { code, inviterId, semData, adClickData } = req.body as {
      code?: string;
      inviterId?: string;
      semData?: SemData;
      adClickData?: AdClickData;
    };
    if (!code)
      return jsonRes(res, {
        message: 'code is invalid',
        code: 400
      });

    await Promise.resolve(
      next({
        ...data,
        code,
        inviterId,
        semData,
        adClickData
      })
    );
  });
export const filterEmailVerifyParams = (
  req: NextApiRequest,
  res: NextApiResponse,
  next: (data: { email: string; code: string; inviterId?: string }) => void
) =>
  filterEmailParams(req, res, async (data) => {
    const { code, inviterId } = req.body as {
      code?: string;
      inviterId?: string;
    };
    if (!code)
      return jsonRes(res, {
        message: EMAIL_STATUS.INVALID_PARAMS,
        code: 400
      });
    await Promise.resolve(
      next({
        ...data,
        code,
        inviterId
      })
    );
  });

export const filterCodeUid = async (
  req: NextApiRequest,
  res: NextApiResponse,
  next: (data: { uid: string }) => void
) => {
  const { uid } = req.body as { uid?: string };
  if (!uid)
    return jsonRes(res, {
      message: 'uid is invalid',
      code: 400
    });
  return await Promise.resolve(
    next({
      uid
    })
  );
};

export const filterCf = async (req: NextApiRequest, res: NextApiResponse, next: () => void) => {
  const { cfToken } = req.body as { cfToken?: string };
  const verifyEndpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  const turnstileConfig = global.AppConfig.desktop.auth.turnstile;
  const secret = turnstileConfig?.cloudflare?.secretKey;
  if (!!turnstileConfig?.enabled && secret) {
    if (!cfToken)
      return jsonRes(res, {
        message: 'cfToken is invalid',
        code: 400
      });

    const verifyRes = await fetch(verifyEndpoint, {
      method: 'POST',
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(cfToken)}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    });
    const data = await verifyRes.json();
    if (!data.success)
      return jsonRes(res, {
        message: 'cfToken is invalid',
        code: 400
      });
  }
  await Promise.resolve(next());
};
export const filterCaptcha = async (
  req: NextApiRequest,
  res: NextApiResponse,
  next: () => void
) => {
  if (
    !global.AppConfig.desktop.auth.captcha?.enabled ||
    (process.env.NODE_ENV === 'development' && !process.env.DEV_CAPTCHA_ENABLED)
  ) {
    await Promise.resolve(next());
    return;
  }
  const { captchaVerifyParam } = req.body as { captchaVerifyParam?: string };
  if (!captchaVerifyParam)
    return jsonRes(res, {
      message: 'captchaVerifyParam is not provided',
      code: 400
    });
  const result = await captchaReq({
    captchaVerifyParam
  });
  if (!result?.verifyResult)
    return jsonRes(res, {
      message: 'captcha verification failed',
      data: {
        result: !!result?.verifyResult,
        code: result?.verifyCode || ''
      },
      code: 409
    });
  await Promise.resolve(next());
};
export const captchaSvc = async (req: NextApiRequest, res: NextApiResponse) => {
  if (process.env.NODE_ENV === 'development' && !process.env.DEV_CAPTCHA_ENABLED) {
    return true;
  }
  const { captchaToken } = req.body as { captchaToken?: string; sceneId?: string };

  if (!captchaToken)
    return jsonRes(res, {
      message: 'captchaToken is invalid',
      code: 400
    });
  const result = await captchaReq({
    captchaVerifyParam: captchaToken
  });
  if (!result?.verifyResult)
    return jsonRes(res, {
      message: 'captchaToken is invalid',
      data: {
        result: !!result?.verifyResult,
        code: result?.verifyCode || ''
      },
      code: 409
    });
  else
    return jsonRes(res, {
      message: 'captchaToken is valid',
      data: {
        result: result.verifyResult,
        code: result?.verifyCode || ''
      },
      code: 203
    });
};

// once code
export const verifyCodeUidGuard =
  (uid: string) =>
  async (res: NextApiResponse, next: (d: { smsInfo: TVerification_Codes }) => void) => {
    const oldSmsInfo = await getInfoByUid({ uid });
    if (!oldSmsInfo)
      return jsonRes(res, {
        message: 'uid is expired',
        code: 409
      });
    await Promise.resolve(next({ smsInfo: oldSmsInfo }));
    // once code
    await deleteByUid({ uid: oldSmsInfo.uid });
  };

export const verifyCodeGuard =
  (id: string, code: string, smsType: SmsType) =>
  async (res: NextApiResponse, next: (d: { smsInfo: TVerification_Codes }) => void) => {
    const smsInfo = await checkCode({ id, smsType, code });
    if (!smsInfo) {
      return jsonRes(res, {
        message: 'SMS code is wrong',
        code: 409
      });
    }
    return await Promise.resolve(next({ smsInfo }));
  };

// export const verifyPhoneCodeGuard = verifyCodeGuard('phone');
// export const verifyEmailCodeGuard = verifyCodeGuard('email');

export const sendSmsCodeGuard = createMiddleware<{ id: string; smsType: SmsType }>(
  async ({ req, res, ctx, next }) => {
    const { id, smsType } = ctx;
    if (!(await checkSendable({ smsType, id }))) {
      return jsonRes(res, {
        message: 'code already sent',
        data: {
          error: 'too_frequent'
        },
        code: 409
      });
    }
    await Promise.resolve(next?.());
  }
);
export const sendNewSmsCodeGuard = createMiddleware<
  {
    smsType: SmsType;
    codeUid: string;
    smsId: string;
  },
  { smsInfo: TVerification_Codes }
>(async ({ res, req, next, ctx }) => {
  const { smsType, smsId, codeUid } = ctx;
  await sendSmsCodeGuard({ smsType, id: smsId })(req, res, async () => {
    const oldSmsInfo = await getInfoByUid({ uid: codeUid });
    if (!oldSmsInfo)
      return jsonRes(res, {
        message: 'uid is expired',
        code: 409
      });
    await Promise.resolve(next({ smsInfo: oldSmsInfo }));
  });
});
// need to get queryParam from after filter
// export const sendSmsCodeGuard =
//   (smsType: SmsType) => (id: string) => async (res: NextApiResponse, next?: () => void) => {
//     if (!(await checkSendable({ smsType, id }))) {
//       return jsonRes(res, {
//         message: 'code already sent',
//         code: 409
//       });
//     }
//     await Promise.resolve(next?.());
//   };
// export const sendNewSmsCodeGuard =
//   (smsType: SmsType) =>
//   (codeUid: string, smsId: string) =>
//   (res: NextApiResponse, next: (d: { smsInfo: TVerification_Codes }) => void) =>
//     sendSmsCodeGuard(smsType)(smsId)(res, async () => {
//       const oldSmsInfo = await getInfoByUid({ uid: codeUid });
//       if (!oldSmsInfo)
//         return jsonRes(res, {
//           message: 'uid is expired',
//           code: 409
//         });
//       await Promise.resolve(next({ smsInfo: oldSmsInfo }));
//     });

// export const sendPhoneCodeGuard = sendSmsCodeGuard('phone');
// export const sendEmailCodeGuard = (email: string) => {

//   return sendSmsCodeGuard('email')(email);
// };

// export const sendNewPhoneCodeGuard = sendNewSmsCodeGuard('phone_change_new');
// export const sendNewEmailCodeGuard = sendNewSmsCodeGuard('email');
