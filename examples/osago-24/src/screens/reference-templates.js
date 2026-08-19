    const commonSteps = {
      scene: {
        title: "Вы на месте ДТП?", duration: "< 1 мин", actor: "Клиент EAI · виновник",
        summary: "Первый вопрос отделяет ДТП, которое оформляют прямо сейчас, от событий из прошлого. Fast flow доступен только на месте происшествия.",
        points: ["Время ответа и GPS фиксируются автоматически", "Ответ «нет» переводит в стандартное заявление", "Колл-центр видит выбранный сценарий и последнюю точку продолжения"],
        screen: "scene"
      },
      safety: {
        title: "Совместимость и оферта", duration: "2 мин", actor: "Клиент EAI · виновник",
        summary: "Клиент получает короткую памятку безопасности, подтверждает условия green path, открывает публичную оферту и ставит явную галочку согласия.",
        points: ["Пострадавшие, спор или подозрение на алкоголь останавливают fast flow", "До фотографий автомобили не перемещают, если они не блокируют движение", "Granite сохраняет ответы, версию оферты и точку выхода для поддержки"],
        screen: "safety"
      },
      cooperation: {
        title: "Оформляете вместе?", duration: "< 1 мин", actor: "Клиент EAI · виновник",
        summary: "Система уточняет, участвует ли второй водитель. Для выплаты за 24 часа оба водителя должны заполнить свои части параллельно.",
        points: ["Рекомендованный путь — оба водителя рядом и сотрудничают", "Отказ, скрывшийся водитель или спор выводят дело из fast flow", "Выбор сохраняется в Granite как причина маршрутизации"],
        screen: "cooperation"
      },
      invite: {
        title: "Способ приглашения", duration: "< 1 мин", actor: "Клиент EAI · виновник",
        summary: "Клиент выбирает понятный способ подключения: показать QR находящемуся рядом потерпевшему или отправить одноразовую web-ссылку.",
        points: ["QR — основной путь для ДТП на месте", "Ссылка открывает ту же защищённую сессию eai.uz", "Язык потерпевшего задаётся до создания приглашения"],
        screen: "invite"
      },
      qr: {
        title: "QR → web-сессия", duration: "1–2 мин", actor: "Виновник в EAI app / потерпевший на eai.uz",
        summary: "Клиент EAI показывает QR. Потерпевший сканирует его обычной камерой телефона и сразу открывает защищённую web-сессию конкретного ДТП на eai.uz — устанавливать приложение не нужно.",
        points: ["QR содержит одноразовую ссылку eai.uz/osago/session/EA24-7K3P", "Web-сессия сразу привязана к делу и роли потерпевшего", "Истёкший токен автоматически заменяется новым"],
        screen: "qr"
      },
      identity: {
        title: "Личность потерпевшего", duration: "2–4 мин", actor: "Потерпевший / MyID / НАПП",
        summary: "Только потерпевший проходит MyID в web-сессии — это нужно для безопасной выплаты и сверки держателя карты. Клиент EAI уже авторизован в приложении и повторно MyID не проходит.",
        points: ["MyID идентифицирует будущего получателя выплаты", "Данные клиента EAI берутся из авторизованного профиля и действующего полиса", "Антифрод: полис EAI действует минимум 12 часов"],
        screen: "identity"
      },
      evidence: {
        title: "Фото и место", duration: "5–8 мин", actor: "Оба водителя",
        summary: "Приложение ведёт по обязательным ракурсам и фиксирует время, геолокацию и целостность снимков. Галерея и выбор готового файла недоступны.",
        points: ["Общий план, повреждения, номера и дорожная обстановка", "Все материалы снимаются только встроенной камерой приложения, в том числе офлайн", "Granite проверяет camera session, время, GPS и целостность оригинала"],
        screen: "evidence"
      },
      protocol: {
        title: "AI-схема ДТП", duration: "< 1 мин", actor: "AI / Granite",
        summary: "AI сам реконструирует схему ДТП по снятым материалам, геолокации, повреждениям и данным автомобилей. Водители ничего не заполняют и не подтверждают.",
        points: ["Computer vision определяет положение, направление движения и зоны удара", "Геолокация и дорожная обстановка привязывают схему к месту ДТП", "При недостаточной уверенности кейс автоматически выходит из green path"],
        screen: "protocol"
      },
      sign: {
        title: "Признание вины", duration: "< 1 мин", actor: "Клиент EAI · виновник",
        summary: "Авторизованный клиент EAI читает формулировку признания вины и ставит отдельную галочку. Повторная идентификация и MyID Face не требуются.",
        points: ["Текст признания показан целиком до согласия", "Галочка не предустановлена", "Granite сохраняет user/session, версию текста и время акцепта"],
        screen: "sign"
      }
    };

    const flows = {
      culprit: {
        title: "Клиент EAI — виновник; EAI платит потерпевшему",
        copy: "До выплаты нужны только данные, которые можно получить на месте и проверить автоматически. Остальной пакет по условиям оферты досылается в течение трёх дней после ДТП и не блокирует перевод.",
        outcome: "ФИНАЛ · ПОТЕРПЕВШИЙ ПОЛУЧИЛ ДЕНЬГИ",
        steps: [
          commonSteps.scene,
          commonSteps.safety,
          commonSteps.cooperation,
          commonSteps.invite,
          commonSteps.qr,
          commonSteps.identity,
          commonSteps.evidence,
          commonSteps.protocol,
          commonSteps.sign,
          {
            title: "Сумма и карта", duration: "2–6 мин", actor: "Damage AI / потерпевший",
            summary: "Damage AI рассчитывает выплату, а потерпевший сразу указывает карту на том же экране. PAN уходит напрямую платёжному провайдеру, держатель сверяется с MyID.",
            points: ["Сумма и реквизиты собраны в одном коротком экране", "UZCARD / HUMO · PAN токенизируется", "Методика расчёта и защита карты раскрываются по запросу"],
            screen: "decision"
          },
          {
            title: "Выплата потерпевшему", duration: "до 30 мин", actor: "EAI / банк",
            summary: "Payment orchestrator переводит рассчитанную сумму на подтверждённую карту потерпевшего без ручного согласования.",
            points: ["Автоматическая проверка получателя", "Статусы банка и 1C синхронизируются с Granite", "Квитанция доступна в web-сессии"],
            screen: "paid"
          },
          {
            title: "Документы до D+3", duration: "в течение 3 дней после ДТП", actor: "Оба водителя",
            summary: "После выплаты приложение и web-сессия напоминают дослать полный пакет по правилам оферты: освидетельствование и остальные обязательные документы.",
            points: ["Срок отсчитывается от времени ДТП", "Каждый документ снимается камерой соответствующей сессии; импорт готового файла отключён", "Неполный пакет создаёт напоминания и фиксируется в Granite, но не задерживает уже выполненную выплату"],
            screen: "documents"
          }
        ]
      }
    };

    const stageOps = {
      scene: {
        mobileEvent: "Ответ «я на месте» + timestamp + GPS snapshot",
        command: "claim_context.open · scene_presence.record · route.evaluate",
        external: "GPS / device clock",
        externalCopy: "Granite фиксирует время, координаты и ответ клиента. События из прошлого направляются в стандартное заявление без создания fast-flow сессии.",
        callReason: "Клиент выбрал «авария произошла раньше» или геолокация недоступна.",
        queue: "AUTO · route selection",
        sla: "немедленно",
        processing: "Определяем подходящий сценарий урегулирования",
        success: "Клиент находится на месте ДТП",
        exception: "Нужен другой сценарий",
        exceptionCopy: "Быстрое оформление доступно на месте ДТП. Для события из прошлого приложение откроет стандартное заявление и сохранит уже известные данные.",
        checks: ["Ответ «на месте» сохранён", "Время устройства подтверждено", "GPS snapshot получен"],
        next: "Показать памятку безопасности"
      },
      safety: {
        mobileEvent: "Safety-check + просмотр оферты + явная галочка клиента EAI",
        command: "eligibility.evaluate · offer.accept · consent.record",
        external: "Геолокация / 112 / Legal",
        externalCopy: "Rules engine проверяет совместимость; consent service сохраняет версию оферты и акцепт авторизованного клиента EAI.",
        callReason: "Есть стоп-условие или клиент EAI не принял оферту.",
        queue: "AUTO · eligibility + consent",
        sla: "немедленно",
        processing: "Проверяем совместимость и фиксируем акцепт оферты",
        success: "Условия выполнены, оферта принята",
        exception: "Нельзя продолжить",
        exceptionCopy: "Продолжение доступно только при выполнении условий европротокола и явном акцепте клиента EAI. При опасности откроется вызов 112.",
        checks: ["Условия европротокола выполнены", "Оферта v1.4 открыта", "Акцепт клиента EAI сохранён"],
        next: "Уточнить участие второго водителя"
      },
      cooperation: {
        mobileEvent: "Выбор «оба водителя участвуют»",
        command: "participants.mode.record · green_path.evaluate",
        external: "Rules / Claims routing",
        externalCopy: "Fast flow продолжается только при двух автомобилях, отсутствии спора и готовности второго водителя участвовать.",
        callReason: "Второй водитель скрылся, отказывается участвовать или есть спор.",
        queue: "AUTO · standard claim routing",
        sla: "немедленно",
        processing: "Проверяем готовность двух сторон",
        success: "Оба водителя оформляют ДТП вместе",
        exception: "Быстрое оформление не подходит",
        exceptionCopy: "Если второй водитель не участвует, приложение сохранит контекст и откроет стандартное урегулирование. Повторно отвечать на вопросы не потребуется.",
        checks: ["Два автомобиля", "Второй водитель участвует", "Спора об обстоятельствах нет"],
        next: "Выбрать способ приглашения"
      },
      invite: {
        mobileEvent: "Выбор QR рядом или одноразовой web-ссылки",
        command: "claim_sessions.prepare · invitation_channel.record",
        external: "eai.uz / locale service",
        externalCopy: "До выпуска токена Granite сохраняет канал приглашения и язык web-сессии потерпевшего.",
        callReason: "Ни QR, ни отправка ссылки недоступны или клиент выбрал неверный язык.",
        queue: "AUTO · invitation setup",
        sla: "1 мин",
        processing: "Готовим персональное приглашение потерпевшему",
        success: "Выбран QR и русский язык",
        exception: "Приглашение не создано",
        exceptionCopy: "Проверьте интернет и язык потерпевшего. Сессия не потеряна — приложение повторит выпуск ссылки автоматически.",
        checks: ["Канал: QR рядом", "Язык: русский", "Роль потерпевшего зарезервирована"],
        next: "Показать QR потерпевшему"
      },
      qr: {
        mobileEvent: "Одноразовый QR → web-сессия → оферта потерпевшего",
        command: "claim_sessions.create · victim_consent.record · web_participants.join",
        external: "https://eai.uz/osago/session/EA24-7K3P",
        externalCopy: "Обычная камера телефона открывает конкретное дело в браузере. До MyID потерпевший открывает оферту v1.4 и ставит явную галочку; установка приложения не нужна.",
        callReason: "Потерпевший не подключился, не принял оферту или web-токен истёк.",
        queue: "AUTO · web session retry",
        sla: "2 мин",
        processing: "Открываем web-сессию и фиксируем акцепт потерпевшего",
        success: "Потерпевший подключён, оферта принята",
        exception: "Не удалось подключиться",
        exceptionCopy: "Ссылка устарела, телефон офлайн или оферта не принята. EAI автоматически обновит QR; продолжение станет доступно после явного акцепта.",
        checks: ["HTTPS-токен действителен", "Акцепт потерпевшего v1.4 сохранён", "WebSocket-канал синхронизации открыт"],
        next: "Подтвердить потерпевшего через MyID"
      },
      identity: {
        mobileEvent: "Потерпевший: MyID login → face capture → verified payee",
        command: "victim.identity.verify · policies.resolve · payee.prepare",
        external: "MyID / НАПП",
        externalCopy: "MyID идентифицирует только потерпевшего. Профиль виновника уже известен из авторизованного приложения EAI и повторно не проверяется.",
        callReason: "MyID не подтвердил личность потерпевшего или данные получателя расходятся.",
        queue: "OSAGO · identity review",
        sla: "5 мин",
        processing: "Подтверждаем личность будущего получателя",
        success: "Потерпевший подтверждён",
        exception: "Данные не совпали",
        exceptionCopy: "Данные не совпали с профилем MyID. Пройдите проверку заново — после двух неудачных попыток оформление продолжит специалист.",
        checks: ["Потерпевший MyID verified", "Клиент EAI взят из active session", "Полис EAI старше 12 часов"],
        next: "Открыть сбор доказательств"
      },
      evidence: {
        mobileEvent: "In-app camera session + EXIF + GPS + offline batch",
        command: "evidence.capture.submit · media.validate · fraud.score",
        external: "Object storage / CV",
        externalCopy: "Принимаются только оригиналы из камеры приложения; camera session, время и GPS сохраняются вместе с кадром.",
        callReason: "Не хватает ракурса, снимок повреждён, геолокация расходится или обнаружен импорт из галереи.",
        queue: "OSAGO · evidence help",
        sla: "5 мин",
        processing: "Проверяем качество и целостность файлов",
        success: "Материалы ДТП приняты",
        exception: "Нужно переснять материал",
        exceptionCopy: "Один из кадров не прошёл проверку. Готовый файл прикрепить нельзя — переснимите нужный ракурс камерой приложения.",
        checks: ["4 ракурса сняты в приложении", "Camera session и время валидны", "GPS в допустимом радиусе"],
        next: "Собрать европротокол"
      },
      protocol: {
        mobileEvent: "Фото, видео, GPS, повреждения и параметры автомобилей",
        command: "collision.reconstruct · confidence.evaluate",
        external: "Computer vision / map data",
        externalCopy: "Модель реконструирует траектории и положение автомобилей без ввода со стороны водителей.",
        callReason: "Уверенность модели ниже порога green path.",
        queue: "AUTO · collision confidence",
        sla: "< 1 мин",
        processing: "AI реконструирует обстоятельства и схему ДТП",
        success: "Схема ДТП построена",
        exception: "Недостаточно данных",
        exceptionCopy: "Алгоритм не выпускает неподтверждённую схему: дело автоматически переходит в стандартное урегулирование.",
        checks: ["Траектории реконструированы", "Зоны удара сопоставлены", "Confidence выше порога"],
        next: "Сформировать документ"
      },
      sign: {
        mobileEvent: "Явная галочка признания вины в active EAI session",
        command: "liability.accept · consent.audit · protocol.finalize",
        external: "Авторизованная сессия EAI",
        externalCopy: "User ID, session/device, версия формулировки и время согласия сохраняются в audit trail. MyID и Face для клиента EAI не запускаются.",
        callReason: "Клиент не поставил галочку или отозвал согласие до завершения.",
        queue: "AUTO · liability consent",
        sla: "< 1 мин",
        processing: "Фиксируем явное согласие клиента",
        success: "Вина подтверждена галочкой",
        exception: "Согласие не дано",
        exceptionCopy: "Без отдельной галочки сценарий не продолжается. Повторная идентификация или MyID не требуются.",
        checks: ["Формулировка показана полностью", "Галочка установлена клиентом", "User/session сохранены"],
        next: "Передать дело на следующий этап"
      },
      decision: {
        mobileEvent: "Показ суммы и ввод PAN на одном экране",
        command: "decision.create · napp.decision.send · payment_methods.tokenize · payee.match",
        external: "Rules / CV / ERSP НАПП / Uzum",
        externalCopy: "Damage AI рассчитывает сумму и передаёт решение в ERSP НАПП; PAN напрямую токенизируется платёжным провайдером, а Granite получает только маску и результат сверки держателя.",
        callReason: "Расчёт вышел из green path, PAN невалиден или держатель карты не совпал с потерпевшим.",
        queue: "OSAGO · decision / card validation",
        sla: "до 15 мин",
        processing: "Считаем выплату и проверяем реквизиты",
        success: "Сумма и карта подтверждены",
        exception: "Нужна проверка суммы или карты",
        exceptionCopy: "Если расчёт не проходит green path, дело уходит специалисту. Ошибку карты потерпевший исправляет прямо на этом же экране.",
        checks: ["Методология применена", "PAN токенизирован", "Держатель совпал с потерпевшим"],
        next: "Отправить деньги"
      },
      card: {
        mobileEvent: "Ввод PAN потерпевшим в web-сессии",
        command: "payment_methods.tokenize · payee.match",
        external: "Uzum / card tokenization",
        externalCopy: "PAN передаётся напрямую платёжному провайдеру по защищённому каналу; Granite получает токен, маску карты и результат сверки держателя.",
        callReason: "PAN не прошёл Luhn-проверку, карта не поддерживается или держатель не совпал с потерпевшим.",
        queue: "AUTO · card validation",
        sla: "< 1 мин",
        processing: "Проверяем карту и получателя",
        success: "Карта подтверждена",
        exception: "Карта не принята",
        exceptionCopy: "Проверьте 16 цифр номера или укажите другую карту UZCARD или HUMO, оформленную на ваше имя.",
        checks: ["PAN валиден", "Карта токенизирована", "Держатель совпал с потерпевшим"],
        next: "Отправить деньги"
      },
      paid: {
        mobileEvent: "Статус перевода в web-сессии потерпевшего",
        command: "claim.payout.create · bank.status.read · napp.payout.send",
        external: "Uzum / банк / 1C",
        externalCopy: "Payment orchestrator автоматически создаёт выплату в Granite; банк исполняет перевод, а 1C отражает проводку следующей синхронизацией.",
        callReason: "Банк отклонил перевод, карта не принадлежит клиенту или платёж завис.",
        queue: "OSAGO · payout failure",
        sla: "5 мин",
        processing: "Отправляем деньги на карту",
        success: "Выплата исполнена",
        exception: "Банк не принял перевод",
        exceptionCopy: "Выберите другую карту на имя заявителя. После подтверждения реквизитов платёж будет повторён автоматически.",
        checks: ["Получатель совпал", "Банк подтвердил перевод", "Проводка 1C придёт следующей синхронизацией"],
        next: "Показать список документов до D+3"
      },
      documents: {
        mobileEvent: "Post-payment checklist и camera-only capture",
        command: "documents.request · capture_session.create · reminders.schedule",
        external: "Наркодиспансер / оферта EAI",
        externalCopy: "Оба участника получают свой checklist. Освидетельствование и остальные документы принимаются в течение трёх дней после ДТП.",
        callReason: "Срок D+3 приближается, документ нечитаем или обязательная позиция отсутствует.",
        queue: "AUTO · D+3 reminders",
        sla: "до 72 часов от ДТП",
        processing: "Проверяем post-payment пакет",
        success: "Полный пакет получен",
        exception: "Остались документы",
        exceptionCopy: "Выплата уже выполнена. Система показывает недостающие позиции, запускает camera-only capture и отправляет автоматические напоминания до конца третьего дня.",
        checks: ["Освидетельствование обоих водителей", "Оригиналы документов сняты камерой", "Срок оферты соблюдён"],
        next: "Закрыть документальный контур"
      },
    };

    const icon = (symbol, tone = "") => `<div class="app-icon ${tone}">${symbol}</div>`;
    const chevron = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const tick = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const eaiIdentityBrand = `
      <div class="myid-eai-brand" aria-label="EUROASIA Insurance">
        <img src="../../assets/eai-logo.svg" alt="EUROASIA Insurance">
      </div>`;
    const myidSafeBrand = `<div class="myid-safe-brand"><img src="../../assets/myid-logo.jpg" alt="MyID — safe identification"></div>`;

    function phoneFrame(content, time = "09:42") {
      // Device shell and status bar belong to CanvasDoc frame.kind="phone".
      // Keep this compatibility-shaped helper so every screen declaration
      // remains content-only without duplicating phone chrome in the iframe.
      return content;
    }

    function myidLoginScreen() {
      return phoneFrame(`
        <div class="phone-content">
          <div class="myid-screen myid-login">
            <span class="myid-close" aria-label="Закрыть MyID"></span>
            ${eaiIdentityBrand}
            <h4 class="myid-login-title">Вход или регистрация</h4>
            <div class="myid-form">
              <div class="myid-field">
                <label>Серия и номер паспорта или ПИНФЛ</label>
                <div class="myid-input">
                  <span>AA1234567 | ПИНФЛ</span>
                  <svg class="myid-scan-icon" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                    <path d="M9 3H6a3 3 0 00-3 3v3M19 3h3a3 3 0 013 3v3M25 19v3a3 3 0 01-3 3h-3M9 25H6a3 3 0 01-3-3v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <rect x="8" y="8" width="12" height="12" rx="3" stroke="currentColor" stroke-width="2"/>
                    <path d="M11 8v12M17 8v12M8 11h12M8 17h12" stroke="currentColor" stroke-width="1.2" opacity=".72"/>
                  </svg>
                </div>
              </div>
              <div class="myid-field">
                <label>Дата рождения</label>
                <div class="myid-input"><span>ДД.ММ.ГГГГ</span></div>
              </div>
              <div class="myid-continue">Продолжить</div>
            </div>
            <p class="myid-consent">Нажимая кнопку, вы соглашаетесь с <a>Пользовательским соглашением</a> и <a>Политикой конфиденциальности</a></p>
          </div>
        </div>`, "1:01");
    }

    function myidFaceScreen({ message = "Смотрите прямо в камеру", tone = "", subject = "Проверка личности" } = {}) {
      return phoneFrame(`
        <div class="phone-content">
          <div class="myid-screen myid-camera ${tone}">
            <span class="myid-close" aria-label="Закрыть MyID"></span>
            ${eaiIdentityBrand}
            <div class="myid-camera-message">${message}</div>
            <div class="myid-camera-shell" role="img" aria-label="${subject}: изображение с фронтальной камеры">
              <div class="myid-camera-feed"><i class="myid-face-guide"></i></div>
            </div>
            ${myidSafeBrand}
          </div>
        </div>`, "1:01");
    }

    function phoneHeader(title, step) {
      const currentStep = activeIndex + 1;
      const totalSteps = activeFlow.steps.length;
      const bars = Array.from({ length: totalSteps }, (_, index) => `<i class="${index + 1 < currentStep ? "done" : index + 1 === currentStep ? "current" : ""}"></i>`).join("");
      return `
        <div class="phone-head">
          <span class="back" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="#536b82" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <h4>${title}</h4>
          <small>${currentStep} / ${totalSteps}</small>
        </div>
        <div class="flow-progress">${bars}</div>`;
    }

    const templates = {
      safety: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Безопасность", 1)}
          <div class="screen-body">
            <div class="app-card dark !p-[15px]">
              <div class="flex items-start gap-3">
                <div class="w-11 h-11 rounded-[14px] bg-white/10 grid place-items-center flex-none">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.8-2.9 8-7 10-4.1-2-7-5.2-7-10V6l7-3z" stroke="#fff" stroke-width="1.7"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div><div class="app-kicker !text-[#93aac1]">Перед оформлением</div><div class="app-title !text-[17px] !mt-1">Все в безопасности?</div><div class="app-copy !text-[#b2c2d2]">Форма подождёт. Сначала убедимся, что европротокол подходит.</div></div>
              </div>
            </div>
            <div class="section-caption">Подтвердите три условия</div>
            <div class="app-card">
              <div class="check-row !items-center"><span class="check">${tick}</span><span class="flex-1">Пострадавших нет</span><span class="font-mono text-[8px] text-[var(--green)]">ДА</span></div>
              <div class="check-row !items-center"><span class="check">${tick}</span><span class="flex-1">Участвуют два автомобиля</span><span class="font-mono text-[8px] text-[var(--green)]">ДА</span></div>
              <div class="check-row !items-center"><span class="check">${tick}</span><span class="flex-1">Нет спора об обстоятельствах</span><span class="font-mono text-[8px] text-[var(--green)]">ДА</span></div>
            </div>
            <div class="info-strip amber">
              <span class="font-mono font-bold text-[9px]">112</span>
              <span>Есть пострадавшие, спор или подозрение на алкоголь? Позвоните 112 — дело сохранится.</span>
            </div>
            <div class="app-btn red">Все в безопасности ${chevron}</div>
            <div class="text-center font-mono text-[7px] text-[var(--muted)]">МЕСТО И ВРЕМЯ УЖЕ ЗАФИКСИРОВАНЫ</div>
          </div>
        </div>`, "09:41"),

      qr: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Подключить водителя", 2)}
          <div class="screen-body">
            <div class="app-card dark text-center !py-[12px]">
              <div class="app-kicker !text-[#93aac1]">Европротокол · EA-24-10387</div>
              <div class="app-title !text-[15px] !mt-1">Покажите QR-код<br>второму водителю</div>
              <img class="qr-image" src="../../assets/qr-invite.svg" alt="QR-код приглашения в дело EA-24-10387" width="148" height="148">
              <span class="invite-code"><span>КОД</span><b class="text-white tracking-[.14em]">EA24-7K3P</b></span>
              <div class="app-copy !text-[#b2c2d2] !mt-2">Сканирование откроет EAI и подключит второй телефон к этому делу.</div>
            </div>
            <div class="app-card !py-[10px]">
              <div class="app-row">
                <div class="app-icon green">A</div>
                <div class="flex-1"><div class="app-title !mt-0 !text-[11px]">Вы · водитель A</div><div class="app-copy !mt-1">Готовы заполнять</div></div>
                <div class="flex items-center gap-2 font-mono text-[7px] text-[var(--green)]"><span class="live-dot"></span>В СЕТИ</div>
              </div>
              <div class="app-row mt-2 pt-2 border-t border-[#edf0f4]">
                <div class="app-icon">B</div>
                <div class="flex-1"><div class="app-title !mt-0 !text-[11px]">Второй водитель</div><div class="app-copy !mt-1">Ожидаем подключение</div></div>
                <span class="waiting-dot"></span>
              </div>
            </div>
            <div class="app-btn ghost">Поделиться ссылкой <span class="text-[15px]">↗</span></div>
          </div>
        </div>`, "09:42"),

      identity: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Личность и полис", 3)}
          <div class="screen-body">
            <div class="info-strip green"><span class="check">${tick}</span><span>MyID вернул подтверждённый профиль. Вводить паспорт вручную не нужно.</span></div>
            <div class="app-card">
              <div class="app-row">
                <div class="profile-orb">АК</div>
                <div class="flex-1"><div class="app-kicker">MyID · подтверждено</div><div class="app-title !mt-1 !text-[13px]">Алишер Каримов</div><div class="app-copy !mt-1">ПИНФЛ · 3•••••••••••6</div></div>
                <span class="font-mono text-[7px] text-[var(--green)]">VERIFIED</span>
              </div>
            </div>
            <div class="policy-card">
              <div class="app-kicker !text-[#8fa7bf]">ОСАГО · GAI № 7723041</div>
              <div class="app-title !text-[12px] !mt-2">Chevrolet Nexia</div>
              <div class="plate">01 Z 748 CB</div>
              <div class="meta-grid"><span>Владелец<b>А. Каримов</b></span><span>Действует до<b>14.03.2027</b></span><span>Полис куплен<b>47 дней назад</b></span><span>Страховщик<b>EUROASIA</b></span></div>
            </div>
            <div class="app-card !py-[9px]">
              <div class="check-row"><span class="check">${tick}</span><span>Автомобиль и владелец совпали</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Полис действовал в момент ДТП</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Антифрод-зазор 12 часов пройден</span></div>
            </div>
            <div class="app-btn">Продолжить ${chevron}</div>
          </div>
        </div>`, "09:43"),

      evidence: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Фото и видео", 4)}
          <div class="screen-body">
            <div class="info-strip"><span>◎</span><span><b>Только камера приложения.</b> Галерея и выбор готового файла недоступны.</span></div>
            <div class="camera-grid">
              <div class="camera-shot done" data-label="Общий план"><img src="../../assets/accident-1.jpg" alt=""><i>${tick}</i></div>
              <div class="camera-shot done" data-label="Повреждение"><img src="../../assets/accident-2.jpg" alt=""><i>${tick}</i></div>
              <div class="camera-shot done" data-label="Госномер / VIN"><img src="../../assets/accident-3.jpg" alt=""><i>${tick}</i></div>
              <div class="camera-shot upload" data-label="Дорожная обстановка"><b>＋</b></div>
            </div>
            <div class="app-card !py-[10px]">
              <div class="app-row">${icon("AI")}<div class="flex-1"><div class="app-title !mt-0 !text-[11px]">3 из 4 обязательных</div><div class="app-copy !mt-1">Качество кадров: хорошее</div></div><span class="font-mono text-[7px] text-[var(--blue)]">ПРОВЕРЕНО</span></div>
              <div class="progress mt-2"><i style="width:75%"></i></div>
            </div>
            <div class="info-strip amber"><span>↻</span><span><b>Офлайн-режим.</b> Камера работает без сети; оригиналы отправятся при подключении.</span></div>
            <div class="app-btn blue">Снять последний ракурс ${chevron}</div>
          </div>
        </div>`, "09:44"),

      protocol: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("AI-схема ДТП", 5)}
          <div class="screen-body">
            <div class="substep-row"><span class="substep done">Материалы ✓</span><span class="substep done">GPS ✓</span><span class="substep active">AI-реконструкция</span></div>
            <div class="app-card !p-[10px]">
              <div class="flex justify-between items-center mb-2"><span class="app-kicker">AUTO · наезд сзади</span><span class="font-mono text-[7px] text-[var(--green)]">96.4%</span></div>
              <div class="map-card"><span class="road-label">УЛ. БАБУРА · НАПРАВЛЕНИЕ ДВИЖЕНИЯ ↑</span><span class="impact"></span></div>
            </div>
            <div class="app-card !py-[9px]">
              <div class="app-kicker">Сигналы модели</div>
              <div class="flex gap-2 flex-wrap mt-2"><span class="px-2 py-1.5 rounded-lg bg-[#eaf0f7] text-[8px] font-bold">CV · зоны удара</span><span class="px-2 py-1.5 rounded-lg bg-[#eaf0f7] text-[8px] font-bold">GPS · траектории</span></div>
            </div>
            <div class="app-card !py-[9px]">
              <div class="app-row"><div class="app-icon">AI</div><div class="flex-1"><div class="app-title !mt-0 !text-[11px]">Действия водителей</div><div class="app-copy !mt-1">Не требуются</div></div><span class="font-mono text-[8px] text-[var(--green)]">AUTO</span></div>
              <div class="progress mt-2"><i style="width:96.4%;background:var(--green)"></i></div>
            </div>
            <div class="app-btn">Продолжить ${chevron}</div>
          </div>
        </div>`, "09:51"),

      sign: () => {
        const culpritName = activeFlowKey === "victim" ? "Д. Юсупов" : "Алишер Каримов";
        const otherName = activeFlowKey === "victim" ? "Алишер Каримов" : "Д. Юсупов";
        return phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Вина и MyID Face", 6)}
          <div class="screen-body">
            <div class="app-card !py-[9px]">
              <div class="app-kicker">Итог европротокола</div>
              <div class="receipt-row mt-2"><span>Участники</span><b>Nexia · Spark</b></div>
              <div class="receipt-row"><span>Пострадавшие</span><b>Нет</b></div>
              <div class="receipt-row"><span>Схема</span><b>Наезд сзади</b></div>
            </div>
            <div class="app-card warning !py-[10px]">
              <div class="flex gap-3 items-start">
                <span class="w-6 h-6 rounded-lg bg-[var(--red)] text-white grid place-items-center flex-none">${tick}</span>
                <div><div class="app-kicker !text-[#996a1e]">Текст волеизъявления</div><div class="app-title !text-[13px]">Я признаю вину в ДТП</div><div class="app-copy">${culpritName} подтверждает этот текст сканом лица.</div></div>
              </div>
            </div>
            <div class="app-card !py-[8px]">
              <div class="signature-row"><span class="signature-avatar">В</span><span><b class="text-[10px] block">${culpritName}</b><small class="text-[8px] text-[var(--muted)]">Виновник · требуется MyID Face</small></span><span class="waiting-dot"></span></div>
              <div class="signature-row"><span class="signature-avatar signed">О</span><span><b class="text-[10px] block">${otherName}</b><small class="text-[8px] text-[var(--muted)]">Ознакомлен с итогом</small></span><span class="check">${tick}</span></div>
            </div>
            <div class="face-scan-card">
              <div class="face-oval"><i class="face-corner tl"></i><i class="face-corner br"></i></div>
              <div class="face-scan-copy"><span class="face-scan-badge"><span class="live-dot"></span>MyID · liveness</span><b class="text-[11px] block">Подтвердите лицо</b><small>Без SMS. Камера проверит, что перед ней живой человек.</small></div>
            </div>
            <div class="app-btn red">Открыть MyID Face ${chevron}</div>
          </div>
        </div>`, "09:55");
      },

      decision: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Проверка дела", 7)}
          <div class="screen-body">
            <div class="app-card dark text-center !py-[14px]">
              <div class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-white/10 font-mono text-[7px] text-[#c4d3e2]"><span class="live-dot"></span>ИДЁТ АВТОУРЕГУЛИРОВАНИЕ</div>
              <div class="font-display text-[28px] tracking-[-.055em] mt-2">00:03:42</div>
              <div class="app-copy !text-[#aebdcd]">Обычно занимает до 5 минут</div>
              <div class="decision-score"><span>НАПП ✓</span><span>MYID ✓</span><span>ФОТО AI ✓</span><span>АНТИФРОД ✓</span></div>
            </div>
            <div class="section-caption">Статус дела</div>
            <div class="app-card !py-[8px]">
              <div class="timeline-mini">
                <div class="timeline-item done">Личности и полисы проверены</div>
                <div class="timeline-item done">Фото, время и место подтверждены</div>
                <div class="timeline-item done">Класс повреждения определён</div>
                <div class="timeline-item active">Формируется решение и сумма</div>
                <div class="timeline-item">Перевод на карту</div>
              </div>
            </div>
            <div class="app-card success !py-[10px]">
              <div class="flex justify-between items-start"><div><div class="app-kicker !text-[var(--green)]">Предварительная сумма</div><div class="amount">8 640 000 <small class="text-[11px]">сум</small></div></div><span class="px-2 py-1 rounded-lg bg-[#daf2e5] text-[var(--green)] font-mono text-[7px]">GREEN</span></div>
              <div class="app-copy">Методология: модель ТС × зона × тяжесть × износ</div>
            </div>
          </div>
        </div>`, "09:58"),

      paid: () => phoneFrame(`
        <div class="phone-content">
          <div class="screen-body !pt-8 items-center text-center">
            <div class="success-ring mt-3"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="mt-4">
              <div class="font-mono text-[8px] text-[var(--green)] uppercase tracking-[.13em]">Выплачено</div>
              <div class="amount !text-[27px]">8 640 000 сум</div>
              <div class="app-copy max-w-[225px] mx-auto">Деньги отправлены на карту. В офис приезжать не нужно.</div>
            </div>
            <div class="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-[#e9f0ff] text-[var(--blue)] font-mono text-[7px]"><span>◷</span> УРЕГУЛИРОВАНО ЗА 28 МИНУТ</div>
            <div class="app-card w-full text-left !py-[10px]">
              <div class="flex items-center gap-3 pb-2 mb-1 border-b border-[#edf0f4]">
                <div class="w-9 h-9 rounded-xl bg-[var(--ink)] text-white grid place-items-center font-extrabold text-[9px]">UZUM</div>
                <div><b class="text-[10px] block">Перевод на UZCARD</b><span class="text-[8px] text-[var(--muted)]">Статус банка · исполнено</span></div>
                <span class="check ml-auto">${tick}</span>
              </div>
              <div class="receipt-row"><span>Карта</span><b>8600 •••• 4417</b></div>
              <div class="receipt-row"><span>Дело</span><b>EA-24-10387</b></div>
              <div class="receipt-row"><span>НАПП · 1С</span><b class="text-[var(--green)]">Синхронизировано</b></div>
            </div>
            <div class="info-strip green w-full text-left"><span>${tick}</span><span>Квитанция и подписанный европротокол сохранены в приложении.</span></div>
            <div class="app-btn green w-full">Открыть квитанцию ${chevron}</div>
          </div>
        </div>`, "10:09"),

      inspection: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Освидетельствование", 7)}
          <div class="screen-body">
            <div class="app-card dark !p-[14px]">
              <div class="flex gap-3 items-start">
                <div class="w-10 h-10 rounded-[13px] bg-white/10 grid place-items-center flex-none">+</div>
                <div><div class="app-kicker !text-[#93aac1]">Обязательно для обоих</div><div class="app-title !text-[16px] !mt-1">Нужны две справки</div><div class="app-copy !text-[#b2c2d2]">Оба водителя едут в наркодиспансер и получают бумажные справки.</div></div>
              </div>
            </div>
            <div class="section-caption">Комплект 0 из 2</div>
            <div class="app-card !py-[8px]">
              <div class="check-row"><span class="waiting-dot"></span><span><b>Водитель A · вы</b><br>Снимите справку в приложении</span></div>
              <div class="check-row"><span class="waiting-dot"></span><span><b>Водитель B</b><br>Ожидаем снимок из его приложения</span></div>
            </div>
            <div class="app-card !py-[8px]">
              <div class="check-row"><span class="check">${tick}</span><span>Весь документ попадает в кадр</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Текст читается, нет бликов</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>ФИО совпадает с участником</span></div>
            </div>
            <div class="info-strip amber"><span>!</span><span><b>Только встроенная камера.</b> Выбрать снимок из галереи или файлов нельзя.</span></div>
            <div class="app-btn blue">Сфотографировать мою справку ${chevron}</div>
          </div>
        </div>`, "10:12"),

      regress: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Регресс", 10)}
          <div class="screen-body">
            <div class="info-strip green"><span class="check">${tick}</span><span><b>Выплата клиенту завершена.</b> Дальше EAI работает со страховой виновника.</span></div>
            <div class="app-card dark !py-[12px]">
              <div class="app-kicker !text-[#93aac1]">Межстраховое требование</div>
              <div class="amount !text-white">8 640 000 <small class="text-[10px]">сум</small></div>
              <div class="app-copy !text-[#b2c2d2]">Получатель · страховая виновника</div>
            </div>
            <div class="app-card !py-[8px]">
              <div class="timeline-mini">
                <div class="timeline-item done">Европротокол и вина приложены</div>
                <div class="timeline-item done">Две справки из наркодиспансера приложены</div>
                <div class="timeline-item done">Расчёт и платёж подтверждены</div>
                <div class="timeline-item active">Требование направлено в другую СК</div>
                <div class="timeline-item">Ожидаем возмещение EAI</div>
              </div>
            </div>
            <div class="app-card !py-[9px]">
              <div class="receipt-row"><span>Требование</span><b>REG-240729-18</b></div>
              <div class="receipt-row"><span>Статус</span><b class="text-[var(--blue)]">Принято</b></div>
              <div class="receipt-row"><span>Участие клиента</span><b>Не требуется</b></div>
            </div>
            <div class="app-btn ghost">Открыть пакет документов ${chevron}</div>
          </div>
        </div>`, "10:11"),

      coverage: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Покрытие EAI", 7)}
          <div class="screen-body">
            <div class="app-card dark text-center !py-[14px]">
              <div class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-white/10 font-mono text-[7px] text-[#c4d3e2]"><span class="live-dot"></span>ПРОВЕРКА ОТВЕТСТВЕННОСТИ</div>
              <div class="app-title !text-white !text-[17px] mt-3">Полис покрывает ДТП</div>
              <div class="app-copy !text-[#aebdcd]">EAI открыла резерв по делу EA-24-10387</div>
            </div>
            <div class="app-card !py-[8px]">
              <div class="check-row"><span class="check">${tick}</span><span>Полис действовал на момент ДТП</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Зазор 12 часов пройден</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Вина подтверждена обеими сторонами</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Событие входит в покрытие</span></div>
            </div>
            <div class="info-strip"><span>i</span><span>Нашему клиенту выплата не положена: он застраховал ответственность, а не свой автомобиль.</span></div>
            <div class="app-card !py-[10px]">
              <div class="receipt-row"><span>Лимит ответственности</span><b>до 40 млн сум</b></div>
              <div class="receipt-row"><span>Следующий шаг</span><b>Требование другой СК</b></div>
            </div>
            <div class="app-btn">Следить за статусом ${chevron}</div>
          </div>
        </div>`, "10:01"),

      incoming: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Требование другой СК", 8)}
          <div class="screen-body">
            <div class="app-card dark !py-[12px]">
              <div class="app-kicker !text-[#93aac1]">Входящее требование</div>
              <div class="amount !text-white">8 640 000 <small class="text-[10px]">сум</small></div>
              <div class="app-copy !text-[#b2c2d2]">Страховая потерпевшего подтвердила выплату</div>
            </div>
            <div class="section-caption">Пакет основания</div>
            <div class="app-card !py-[8px]">
              <div class="check-row"><span class="check">${tick}</span><span>Подписанный европротокол</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Фото и материалы ДТП</span></div>
              <div class="check-row"><span class="check">${tick}</span><span>Расчёт и подтверждение выплаты</span></div>
            </div>
            <div class="app-card warning !py-[10px]">
              <div class="app-kicker !text-[#996a1e]">Проверка EAI</div>
              <div class="app-title !text-[12px]">Сумма и повреждения сверяются</div>
              <div class="app-copy">При расхождениях требование вернётся с мотивировкой.</div>
              <div class="progress mt-3"><i style="width:68%;background:var(--amber)"></i></div>
            </div>
            <div class="info-strip"><span>i</span><span>От нашего клиента дополнительных действий не требуется.</span></div>
          </div>
        </div>`, "14:36"),

      reimbursed: () => phoneFrame(`
        <div class="phone-content">
          ${phoneHeader("Дело закрыто", 9)}
          <div class="screen-body !pt-7 items-center text-center">
            <div class="success-ring mt-2"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="mt-4">
              <div class="font-mono text-[8px] text-[var(--green)] uppercase tracking-[.13em]">Возмещение исполнено</div>
              <div class="amount !text-[24px]">8 640 000 сум</div>
              <div class="app-copy max-w-[230px] mx-auto">EAI перечислила подтверждённую сумму страховой потерпевшего.</div>
            </div>
            <div class="app-card w-full text-left !py-[9px]">
              <div class="receipt-row"><span>Получатель</span><b>Другая страховая</b></div>
              <div class="receipt-row"><span>Наш клиент</span><b>Виновник</b></div>
              <div class="receipt-row"><span>Выплата клиенту</span><b>Не предусмотрена</b></div>
              <div class="receipt-row"><span>Статус дела</span><b class="text-[var(--green)]">Закрыто</b></div>
            </div>
            <div class="info-strip green w-full text-left"><span>${tick}</span><span>Обязательства EAI перед страховой потерпевшего исполнены.</span></div>
            <div class="app-btn green w-full">Открыть итог дела ${chevron}</div>
          </div>
        </div>`, "15:04")
    };

    function mobileNav(title) {
      const current = activeIndex + 1;
      const total = activeFlow.steps.length;
      const progress = Math.round((current / total) * 100);
      return `
        <div class="mobile-nav">
          <span class="mobile-back" aria-hidden="true">${chevron.replace("M9 6l6 6-6 6", "M15 6l-6 6 6 6")}</span>
          <strong>${title}</strong>
          <span class="mobile-step">${current} из ${total}</span>
        </div>
        <div class="mobile-progress" style="--progress:${progress}%"><i></i></div>`;
    }

    function mobileScreen({ nav, kicker, title, lead, body, action = "", tone = "", time = "09:42" }) {
      return phoneFrame(`
        <div class="phone-content">
          ${mobileNav(nav)}
          <div class="mobile-main">
            <div class="mobile-kicker">${kicker}</div>
            <h4 class="mobile-title">${title}</h4>
            ${lead ? `<p class="mobile-lead">${lead}</p>` : ""}
            <div class="mobile-body">${body}</div>
            ${action ? `<div class="mobile-action ${tone}">${action}</div>` : ""}
          </div>
        </div>`, time);
    }

    const polishedTemplates = {
      scene: () => mobileScreen({
        nav: "Новое ДТП",
        kicker: "Шаг 1 · выбор сценария",
        title: "Вы сейчас на месте ДТП?",
        lead: "Это определит, какой сценарий откроет приложение. Время и место мы зафиксируем автоматически.",
        body: `
          <div class="mobile-choice-grid">
            <div class="mobile-choice recommended">
              <span class="mobile-choice-icon">NOW</span>
              <span><b>Да, я на месте</b><small>Продолжить быстрое оформление ДТП</small></span>
              <i>›</i>
            </div>
            <div class="mobile-choice">
              <span class="mobile-choice-icon">PAST</span>
              <span><b>Нет, авария произошла раньше</b><small>Открыть стандартное заявление</small></span>
              <i>›</i>
            </div>
          </div>
          <div class="mobile-context-strip">
            <span>Время устройства<b>09:40 · сейчас</b></span>
            <span>Геолокация<b>Ташкент · ±14 м</b></span>
          </div>
          <div class="mobile-note"><span>i</span><span>Если связь прервётся, колл-центр увидит выбранный сценарий и поможет продолжить с этого места.</span></div>`,
        time: "09:40"
      }),

      safety: () => mobileScreen({
        nav: "Новое ДТП",
        kicker: "Шаг 2 · безопасность и условия",
        title: "Сначала безопасность",
        lead: "Форма подождёт. Убедитесь, что европротокол подходит, затем примите условия быстрого урегулирования.",
        body: `
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check">1</span><div>Пострадавших нет<small>Если есть — немедленно звоните 112</small></div></div>
            <div class="mobile-list-row"><span class="mobile-check">2</span><div>Место ДТП обозначено<small>Аварийка, знак и безопасная зона</small></div></div>
            <div class="mobile-list-row"><span class="mobile-check">3</span><div>Спора и признаков опьянения нет<small>Иначе вызывайте 112</small></div></div>
          </div>
          <div class="mobile-doc">
            <div class="mobile-doc-head">
              <div><strong>Публичная оферта EAI</strong><small>Быстрое урегулирование ОСАГО</small></div>
              <span class="mobile-status">v1.4</span>
            </div>
            <div class="mobile-offer-link"><span>Открыть полный текст · 12 страниц</span><span>↗</span></div>
          </div>
          <div class="mobile-offer-consent">
            <span class="mobile-check">${tick}</span>
            <span>Я подтверждаю совместимость с европротоколом, прочитал оферту EAI v1.4 и принимаю её условия.</span>
          </div>
          <div class="mobile-note alert"><span>!</span><span>Не перемещайте автомобили до фотографий, если они не блокируют движение.</span></div>`,
        action: `Всё безопасно — принять и продолжить ${chevron}`,
        tone: "red",
        time: "09:41"
      }),

      cooperation: () => mobileScreen({
        nav: "Участники ДТП",
        kicker: "Шаг 3 · режим оформления",
        title: "Другой водитель участвует?",
        lead: "Для выплаты за 24 часа оба водителя заполняют свои части параллельно — каждый на своём телефоне.",
        body: `
          <div class="mobile-choice-grid">
            <div class="mobile-choice recommended">
              <span class="mobile-choice-icon">A+B</span>
              <span><b>Да, оформляем вместе</b><small>Два телефона · одна синхронная сессия</small></span>
              <i>›</i>
            </div>
            <div class="mobile-choice alert">
              <span class="mobile-choice-icon">A</span>
              <span><b>Нет, второй водитель не участвует</b><small>Отказ, спор или водитель уехал</small></span>
              <i>›</i>
            </div>
          </div>
          <div class="mobile-note good"><span>${tick}</span><span><strong>Быстрое оформление:</strong> два автомобиля, нет пострадавших, оба участника рядом и согласны оформить ДТП.</span></div>`,
        time: "09:42"
      }),

      invite: () => mobileScreen({
        nav: "Второй водитель",
        kicker: "Шаг 4 · приглашение",
        title: "Как подключить второго водителя?",
        lead: "Оба способа откроют одну защищённую страницу на eai.uz. Приложение потерпевшему не нужно.",
        body: `
          <div class="mobile-choice-grid">
            <div class="mobile-choice recommended">
              <span class="mobile-choice-icon">QR</span>
              <span><b>Мы сейчас рядом</b><small>Показать QR для обычной камеры телефона</small></span>
              <i>›</i>
            </div>
            <div class="mobile-choice">
              <span class="mobile-choice-icon">LINK</span>
              <span><b>Отправить web-ссылку</b><small>Поделиться через SMS или мессенджер</small></span>
              <i>›</i>
            </div>
          </div>
          <div class="mobile-doc">
            <div class="mobile-doc-row"><span>Язык потерпевшего</span><b>Русский · изменить</b></div>
            <div class="mobile-doc-row"><span>Сессия</span><b>Одноразовая · 10 минут</b></div>
          </div>`,
        time: "09:42"
      }),

      qr: () => mobileScreen({
        nav: "Второй водитель",
        kicker: "Дело EA-24-10387",
        title: "Покажите QR потерпевшему",
        lead: "Обычная камера телефона откроет защищённую страницу на eai.uz. Первым экраном потерпевший примет ту же оферту v1.4; скачивать приложение не нужно.",
        body: `
          <img class="mobile-qr" src="../../assets/qr-invite.svg" alt="QR-код приглашения в дело">
          <div class="mobile-code">eai.uz/osago/session/<b>EA24-7K3P</b></div>
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Клиент EAI подключён<small>Виновник · мобильное приложение</small></div><span class="mobile-status">Онлайн</span></div>
            <div class="mobile-list-row"><span class="mobile-check pending">2</span><div>Потерпевший<small>eai.uz → оферта v1.4 → MyID</small></div></div>
          </div>`,
        action: "Скопировать web-ссылку",
        tone: "secondary",
        time: "09:42"
      }),

      identity: () => myidLoginScreen(),


      evidence: () => mobileScreen({
        nav: "Фото с места",
        kicker: "3 из 4 ракурсов готовы",
        title: "Снимите дорожную обстановку",
        lead: "Откройте встроенную камеру и снимите разметку, знаки и положение обоих автомобилей одним широким кадром.",
        body: `
          <div class="mobile-photo-grid">
            <div class="mobile-photo"><img src="../../assets/accident-1.jpg" alt=""><span>Общий план</span></div>
            <div class="mobile-photo"><img src="../../assets/accident-2.jpg" alt=""><span>Повреждение</span></div>
            <div class="mobile-photo"><img src="../../assets/accident-3.jpg" alt=""><span>Госномер</span></div>
          </div>
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Место и время записаны<small>ул. Бабура, 41 · 09:44</small></div></div>
            <div class="mobile-list-row"><span class="mobile-check pending">4</span><div>Дорожная обстановка<small>Остался один кадр</small></div></div>
          </div>
          <div class="mobile-note alert"><span>▣</span><span><strong>Галерея недоступна.</strong> Принимаются только оригиналы, снятые камерой приложения. Без интернета они отправятся позже.</span></div>`,
        action: "Снять в приложении",
        tone: "red",
        time: "09:44"
      }),

      protocol: () => mobileScreen({
        nav: "Материалы приняты",
        kicker: "AI-реконструкция · без действий",
        title: "Схему ДТП построит AI",
        lead: "Можно продолжать оформление. Алгоритм использует уже снятые материалы и не просит водителей заполнять или проверять схему.",
        body: `
          <div class="mobile-diagram" aria-label="Схема ДТП"></div>
          <div class="mobile-doc">
            <div class="mobile-doc-row"><span>Источник</span><b>Фото · видео · GPS</b></div>
            <div class="mobile-doc-row"><span>Реконструкция</span><b>Выполняется автоматически</b></div>
            <div class="mobile-doc-row"><span>Действия водителей</span><b>Не требуются</b></div>
          </div>
          <div class="mobile-note"><span>AI</span><span>Если уверенность модели ниже порога, дело автоматически выйдет из 24-часового сценария.</span></div>`,
        action: `Продолжить ${chevron}`,
        time: "09:51"
      }),

      sign: () => mobileScreen({
        nav: "Подтверждение вины",
        kicker: "Клиент EAI · авторизован",
        title: "Подтвердите признание вины",
        lead: "Прочитайте формулировку и поставьте отдельную галочку. MyID, Face ID и SMS-код не нужны.",
        body: `
          <div class="mobile-doc">
            <div class="mobile-doc-row"><span>Автомобили</span><b>Nexia · Spark</b></div>
            <div class="mobile-doc-row"><span>Пострадавшие</span><b>Нет</b></div>
            <div class="mobile-doc-row"><span>Обстоятельство</span><b>Наезд сзади</b></div>
            <div class="mobile-doc-row"><span>Виновник</span><b>Алишер Каримов · клиент EAI</b></div>
          </div>
          <div class="mobile-offer-consent" style="align-items:flex-start">
            <span class="mobile-check">${tick}</span>
            <span><strong>Я признаю вину в этом ДТП.</strong><br>Мне показаны обстоятельства и AI-схема. Я подтверждаю признание добровольно.</span>
          </div>
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Профиль клиента<small>Авторизован в EAI app</small></div><span class="mobile-status">Подтверждён</span></div>
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Согласие зафиксировано<small>Текст, время и устройство · 09:55</small></div><span class="mobile-status">Сохранено</span></div>
          </div>`,
        action: "Подтвердить и продолжить",
        tone: "red",
        time: "09:55"
      }),





      documents: () => mobileScreen({
        nav: "Документы после ДТП",
        kicker: "По оферте · срок до 01.08.2026",
        title: "Дослать пакет в течение 3 дней",
        lead: "Выплата потерпевшему уже исполнена и не отзывается. Теперь от вас нужен пакет по условиям принятой оферты.",
        body: `
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check pending">1</span><div>Справка из наркодиспансера<small>Ваша · снять камерой приложения</small></div><span class="mobile-status" style="background:#fff4df;color:#9a6714">Нужно</span></div>
            <div class="mobile-list-row"><span class="mobile-check pending">2</span><div>Остальные документы по оферте<small>Персональный список в деле</small></div><span class="mobile-status" style="background:#fff4df;color:#9a6714">Нужно</span></div>
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Полис, ТС, личность и фото с места<small>Есть в вашем профиле EAI · паспорт не нужен</small></div><span class="mobile-status">Готово</span></div>
          </div>
          <div class="mobile-note alert"><span>!</span><span><strong>Что будет, если не прислать.</strong> Если справка покажет опьянение или пакет не поступит до конца третьего дня, EAI взыщет выплаченные 8 640 000 сум с вас в порядке регресса.</span></div>
          <div class="mobile-note"><span>▣</span><span>Документы принимаются только камерой приложения. Выбор файла из галереи отключён.</span></div>`,
        action: "Снять справку",
        tone: "red",
        time: "10:22"
      }),




    };

    /* Web-сессия потерпевшего: тот же телефон, но браузер на eai.uz, без установки приложения. */
    function webScreen({ step, kicker, title, lead, body, action = "", tone = "", time = "09:45" }) {
      const [currentStep, totalSteps] = step.split(" из ").map(Number);
      return phoneFrame(`
        <div class="phone-content web-session">
          <div class="web-bar">
            <span class="web-lock" aria-hidden="true"></span>
            <span class="web-url">eai.uz<b>/osago/session/EA24-7K3P</b></span>
            <span class="web-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </div>
          <div class="web-step">
            <span>Шаг ${step}</span>
            <i style="--progress:${Math.round((currentStep / totalSteps) * 100)}%"></i>
          </div>
          <div class="mobile-main">
            <div class="mobile-kicker">${kicker}</div>
            <h4 class="mobile-title">${title}</h4>
            ${lead ? `<p class="mobile-lead">${lead}</p>` : ""}
            <div class="mobile-body">${body}</div>
            ${action ? `<div class="mobile-action ${tone}">${action}</div>` : ""}
          </div>
        </div>`, time);
    }

    /* Экраны, которые видит ТОЛЬКО потерпевший. Живут в своей дорожке полотна. */
    const victimTemplates = {
      qr: () => webScreen({
        step: "1 из 7",
        kicker: "Дело EA-24-10387 · вас пригласил второй водитель",
        title: "Примите условия, чтобы продолжить",
        lead: "Защищённая сессия конкретного ДТП, приложение не нужно. Первый шаг — та же оферта, которую принял второй водитель.",
        body: `
          <div class="mobile-doc">
            <div class="mobile-doc-head">
              <div><strong>Публичная оферта EAI</strong><small>Версия закреплена за сессией целиком</small></div>
              <span class="mobile-status">v1.4</span>
            </div>
            <div class="mobile-offer-link"><span>Открыть полный текст · 12 страниц</span><span>↗</span></div>
          </div>
          <div class="mobile-offer-consent">
            <span class="mobile-check">${tick}</span>
            <span>Я прочитал оферту EAI v1.4 и принимаю её условия, включая срок предоставления документов до конца третьего дня.</span>
          </div>
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Второй водитель<small>Алишер Каримов · клиент EAI</small></div><span class="mobile-status">Онлайн</span></div>
            <div class="mobile-list-row"><span class="mobile-check pending">2</span><div>Ваша роль<small>Потерпевший · получатель выплаты</small></div></div>
          </div>
          <div class="mobile-note"><span>i</span><span>Язык страницы можно сменить в любой момент.</span></div>`,
        action: `Принять и подтвердить личность ${chevron}`,
        tone: "red",
        time: "09:43"
      }),

      evidence: () => webScreen({
        step: "4 из 7",
        kicker: "Ваша часть материалов",
        title: "Снимите повреждения своей машины",
        lead: "Камера открывается прямо в браузере. Место ДТП и своё авто снимает второй водитель.",
        body: `
          <div class="mobile-photo-grid">
            <div class="mobile-photo"><img src="../../assets/accident-2.jpg" alt=""><span>Повреждение</span></div>
            <div class="mobile-photo"><img src="../../assets/accident-3.jpg" alt=""><span>Госномер</span></div>
            <div class="mobile-photo upload"><span>Общий план</span></div>
          </div>
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Место и время записаны<small>ул. Бабура, 41 · 09:48</small></div></div>
            <div class="mobile-list-row"><span class="mobile-check pending">3</span><div>Общий план вашей машины<small>Остался один кадр</small></div></div>
          </div>
          <div class="mobile-note alert"><span>▣</span><span><strong>Галерея недоступна.</strong> Только кадры этой камеры. Виновник: 4 из 4 · вы: 2 из 3 — расчёт стартует, когда закончат оба.</span></div>`,
        action: "Открыть камеру",
        tone: "red",
        time: "09:48"
      }),

      protocol: () => webScreen({
        step: "5 из 7",
        kicker: "AI-реконструкция · подтверждать не нужно",
        title: "Схему ДТП построил алгоритм",
        lead: "Схема собрана по материалам, геолокации и повреждениям. Вы её просматриваете, но не заполняете и не подтверждаете.",
        body: `
          <div class="mobile-diagram" aria-label="Схема ДТП"></div>
          <div class="mobile-doc">
            <div class="mobile-doc-row"><span>Обстоятельство</span><b>Наезд сзади</b></div>
            <div class="mobile-doc-row"><span>Уверенность модели</span><b>96.4%</b></div>
            <div class="mobile-doc-row"><span>Ваши действия</span><b>Не требуются</b></div>
          </div>
          <div class="mobile-note"><span>AI</span><span>Уверенность ниже порога — дело уходит в стандартное урегулирование.</span></div>`,
        action: `Продолжить ${chevron}`,
        time: "09:51"
      }),

      decision: () => webScreen({
        step: "6 из 7",
        kicker: "Выплата одобрена",
        title: "Получите деньги на карту",
        lead: "Проверьте сумму и укажите свою UZCARD или HUMO.",
        body: `
          <div class="payout-summary">
            <div class="payout-summary-head"><span class="mobile-status">Готово к выплате</span><span>Дело EA-24-10387</span></div>
            <div class="mobile-amount">8 640 000 <small>сум</small></div>
            <div class="payout-payee"><span>Получатель</span><b>Д. Юсупов · подтверждён MyID</b></div>
          </div>
          <div class="mobile-card-field">
            <div class="mobile-card-field-head">
              <label for="victim-card-number">Номер карты</label>
              <span class="mobile-card-brands"><i>UZCARD</i><i>HUMO</i></span>
            </div>
            <div class="mobile-card-input">
              <input id="victim-card-number" inputmode="numeric" autocomplete="cc-number" value="8600 1234 5688 4417" aria-describedby="victim-card-help">
              <span aria-hidden="true">${tick}</span>
            </div>
            <p class="mobile-card-help" id="victim-card-help">Карта должна быть оформлена на ваше имя</p>
          </div>
          <div class="mobile-disclosures">
            <details class="mobile-disclosure">
              <summary>Как рассчитали сумму</summary>
              <p class="mobile-disclosure-copy">Повреждения распознал Damage AI. Расчёт выполнен по методологии EAI 2.3 и зарегистрирован в ERSP НАПП.</p>
            </details>
            <details class="mobile-disclosure">
              <summary>Как защищены реквизиты</summary>
              <p class="mobile-disclosure-copy">Номер уходит напрямую платёжному провайдеру. EAI сохраняет только токен и последние четыре цифры.</p>
            </details>
          </div>`,
        action: "Получить 8 640 000 сум",
        tone: "red",
        time: "10:18"
      }),

      documents: () => webScreen({
        step: "7 из 7",
        kicker: "По оферте · срок до 01.08.2026",
        title: "Осталось дослать документы",
        lead: "Деньги уже на вашей карте. Пакет по условиям принятой вами оферты нужно прислать до конца третьего дня.",
        body: `
          <div class="mobile-note good"><span>${tick}</span><span><strong>8 640 000 сум зачислены.</strong> Этот список не задерживал выплату.</span></div>
          <div class="mobile-list">
            <div class="mobile-list-row"><span class="mobile-check pending">1</span><div>Справка из наркодиспансера<small>Ваша · снять камерой сессии</small></div><span class="mobile-status" style="background:#fff4df;color:#9a6714">Нужно</span></div>
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Личность и паспортные данные<small>Взяты из MyID · фотографировать не нужно</small></div><span class="mobile-status">Готово</span></div>
            <div class="mobile-list-row"><span class="mobile-check">${tick}</span><div>Фото повреждений<small>Получены до выплаты</small></div><span class="mobile-status">Готово</span></div>
          </div>
          <div class="mobile-note"><span>SMS</span><span>Ссылка на эту сессию придёт вам повторно на D+1 и D+2 — переход по ней снова откроет камеру.</span></div>`,
        action: "Снять справку",
        tone: "red",
        time: "10:24"
      }),

      paid: () => webScreen({
        step: "7 из 7",
        kicker: "Дело EA-24-10387",
        title: "Деньги отправлены",
        lead: "Перевод поступит на карту в течение нескольких минут.",
        body: `
          <div class="mobile-success-mark">${tick.replace('width="11" height="11"', 'width="30" height="30"')}</div>
          <div class="text-center"><div class="mobile-amount">8 640 000 <small>сум</small></div><p class="mobile-lead">UZCARD •••• 4417</p></div>
          <div class="mobile-doc">
            <div class="mobile-doc-row"><span>Получатель</span><b>Д. Юсупов · потерпевший</b></div>
            <div class="mobile-doc-row"><span>Банк</span><b>Uzum</b></div>
            <div class="mobile-doc-row"><span>Статус</span><b style="color:#208758">Исполнено</b></div>
            <div class="mobile-doc-row"><span>Время урегулирования</span><b>41 минута</b></div>
          </div>
          <div class="mobile-note good"><span>${tick}</span><span>Выплата завершена. До 01.08.2026 обеим сторонам нужно дослать документы по условиям оферты.</span></div>`,
        action: "Скачать квитанцию",
        tone: "secondary",
        time: "10:21"
      })
    };

    /* Заголовок экрана в приложении — пользовательский, а не название этапа диаграммы. */
    const screenNav = {
      scene:"Новое ДТП", safety:"Новое ДТП", cooperation:"Участники ДТП",
      invite:"Второй водитель", qr:"Второй водитель",
      identity:"Подтверждение личности", evidence:"Фото с места", protocol:"Схема ДТП",
      sign:"Подтверждение вины", decision:"Сумма и карта", card:"Карта для выплаты",
      paid:"Выплата", documents:"Документы после ДТП"
    };

    function renderMobileState(item, ops, kind) {
      /* Три класса исключений отличаются тем, что происходит дальше, а не только заголовком. */
      const policy = kind && typeof kind === "object" ? kind : { kind:"auto", title:"Авто-повтор", retry:ops.sla, detail:"" };
      /* На экране — только то, что нужно человеку: что случилось, что делать и что уже сохранено.
         Класс исключения, лимиты повторов и коды ошибок живут на узле полотна и в консоли оператора. */
      const said = policy.userDetail || policy.detail;
      const outcome = {
        user: {
          note:`<div class="mobile-note alert"><span>!</span><span><strong>Нужно ваше действие.</strong> ${said}</span></div>`,
          steps:[["warn","1", said], ["pending","2", "Всё, что вы уже подтвердили, сохранено"]],
          action:"Исправить и продолжить"
        },
        auto: {
          note:`<div class="mobile-note"><span>↻</span><span><strong>Мы повторим сами.</strong> ${said} Закрывать экран не нужно.</span></div>`,
          steps:[["warn","1", "Пробуем ещё раз — от вас ничего не нужно"], ["pending","2", "Если не получится, с вами свяжется оператор"]],
          action:"Оставить как есть"
        },
        terminal: {
          note:`<div class="mobile-note alert"><span>■</span><span><strong>Быстрое оформление недоступно.</strong> ${said}</span></div>`,
          steps:[["warn","1", "Заявление переведено в обычное урегулирование"], ["pending","2", "Ранее подтверждённые данные сохранены"]],
          action:"Открыть стандартное заявление"
        }
      }[policy.kind];
      const caseKnown = !["scene", "safety", "cooperation", "invite"].includes(item.screen);
      return mobileScreen({
        nav: screenNav[item.screen] || item.title,
        kicker: policy.kind === "terminal" ? "Обычное урегулирование" : "Не получилось продолжить",
        title: ops.exception,
        lead: ops.exceptionCopy,
        body: `
          ${outcome.note}
          ${caseKnown ? `<div class="mobile-doc">
            <div class="mobile-doc-row"><span>Номер дела</span><b>EA-24-10387</b></div>
            <div class="mobile-doc-row"><span>Телефон поддержки</span><b>1198</b></div>
          </div>` : ""}
          <div class="mobile-list">
            ${outcome.steps.map(([tone, num, text]) => `<div class="mobile-list-row"><span class="mobile-check ${tone}">${num}</span><div>${text}</div></div>`).join("")}
          </div>`,
        action: outcome.action,
        tone: policy.kind === "terminal" ? "secondary" : "red",
        time: "10:04"
      });
    }

    function graniteIcon(name) {
      const paths = {
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
        claim: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-5"/>',
        queue: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h8"/>',
        money: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 9h2M6 15H4"/><circle cx="12" cy="12" r="3"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
        bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
        back: '<path d="m15 18-6-6 6-6"/>'
      };
      return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
    }

    function graniteChrome(content, section = "claims") {
      const isCalls = section === "calls";
      return `
        <div class="granite-window">
          <div class="granite-shell">
            <aside class="granite-sidebar">
              <div class="granite-logo"><img src="../../assets/granite-logo.svg" alt="Granite"></div>
              <div class="granite-side-primary">
                <div class="granite-nav-item">${graniteIcon("home")}Быстрые ссылки</div>
                <div class="granite-nav-item">${graniteIcon("file")}Центр помощи</div>
              </div>
              <div class="granite-side-rule"></div>
              <div class="granite-product-switch">
                <span class="${isCalls ? "" : "active"}">ERP</span>
                <span class="${isCalls ? "active" : ""}">CRM</span>
                <span>ЭДО</span>
              </div>
              <nav class="granite-nav">
                ${isCalls
                  ? `
                    <div class="granite-nav-item">${graniteIcon("queue")}Чаты</div>
                    <div class="granite-nav-item">${graniteIcon("users")}Клиенты</div>
                    <div class="granite-nav-item">${graniteIcon("file")}Договоры</div>
                    <div class="granite-nav-item active">${graniteIcon("claim")}Запросы ОСАГО</div>
                    <div class="granite-nav-sub current">Очередь исключений · 8</div>
                    <div class="granite-nav-sub">Перезвоны · 3</div>
                    <div class="granite-nav-item">${graniteIcon("users")}Реферальная программа</div>
                    <div class="granite-nav-item">${graniteIcon("file")}Чёрный список</div>
                    <div class="granite-nav-item">${graniteIcon("bell")}Рассылки</div>`
                  : `
                    <div class="granite-nav-item">${graniteIcon("file")}Портфель</div>
                    <div class="granite-nav-item">${graniteIcon("queue")}Аналитика</div>
                    <div class="granite-nav-item">${graniteIcon("file")}Отчёты НАПП</div>
                    <div class="granite-nav-item">${graniteIcon("money")}Резервы</div>
                    <div class="granite-nav-item active">${graniteIcon("claim")}Претензии</div>
                    <div class="granite-nav-item">${graniteIcon("file")}Бухгалтерия</div>
                    <div class="granite-nav-item">${graniteIcon("claim")}Международное перестрахование</div>
                    <div class="granite-nav-item">${graniteIcon("queue")}РЕ-претензии</div>`}
              </nav>
            </aside>
            <div class="granite-workspace">
              <div class="granite-topbar">
                <div class="granite-top-actions">
                  <span class="g-command">${graniteIcon("search")}⌘K</span>
                  <span class="granite-icon-btn">▣</span>
                  <span class="granite-avatar">AA</span>
                </div>
              </div>
              ${content}
            </div>
          </div>
        </div>`;
    }

    function renderGraniteWorkspace(item, ops) {
      const role = activeFlowKey === "victim" ? "Потерпевший" : "Виновник";
      const row = (icon, title, copy, meta, tone = "") => `
        <div class="g-row">
          <span class="g-row-icon ${tone}">${icon}</span>
          <span class="g-row-main"><b>${title}</b><small>${copy}</small></span>
          <span class="g-row-meta">${meta}</span>
        </div>`;
      const panel = (title, meta, body) => `
        <section class="g-panel"><header class="g-panel-head"><span>${title}</span><small>${meta}</small></header>${body}</section>`;
      const metric = (label, value, note = "") => `<div class="g-metric"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ""}</div>`;
      const stageViews = {
        scene: {
          status:"FAST FLOW CANDIDATE", tone:"good", title:"Маршрутизировать новое ДТП",
          sub:"Granite сохраняет первый ответ, время устройства и GPS snapshot до создания дела — этот контекст доступен поддержке даже при обрыве сессии.",
          body: `
            <div class="g-grid-3">${metric("Ответ","На месте","выбран в 09:40:12")}${metric("GPS","± 14 м","Ташкент · ул. Бабура")}${metric("Давность","18 сек","device clock verified")}</div>
            <div class="g-grid-2">
              ${panel("Сигналы маршрутизации","PRE-FLIGHT",[
                row("✓","Событие происходит сейчас","Клиент подтвердил нахождение на месте","PASS","good"),
                row("✓","Геолокация доступна","GPS snapshot сохранён","PASS","good"),
                row("✓","Сессия авторизована","Клиент EAI · user 18421","PASS","good")
              ].join(""))}
              ${panel("Контекст для поддержки","RESUME POINT",`
                <div class="g-list-row"><span>Последний экран</span><b>01 · На месте ДТП</b></div>
                <div class="g-list-row"><span>Выбранный путь</span><b class="g-ok">FAST FLOW</b></div>
                <div class="g-list-row"><span>При обрыве</span><b>Продолжить с safety briefing</b></div>
                <div class="g-actions"><span class="g-btn">Открыть context trail</span><span class="g-btn primary">AUTO · продолжить</span></div>`)}
            </div>`
        },
        safety: {
          status:"ELIGIBLE · OFFER ACCEPTED", tone:"good", title:"Проверить совместимость и зафиксировать акцепт",
          sub:"Granite одним этапом сохраняет результат eligibility rules и audit явного акцепта клиента EAI в авторизованной сессии.",
          body: `
            <div class="g-grid-3">${metric("Eligibility","PASS","3 из 3 условий")}${metric("Оферта","v1.4","hash 9A7F…31C2")}${metric("Акцепт","09:41:38","EAI user 18421")}</div>
            <div class="g-grid-2">
              ${panel("Стоп-условия","3 ПРОВЕРКИ",[
                row("✓","Пострадавших нет","Подтверждено клиентом EAI","PASS","good"),
                row("✓","Два автомобиля","Состав события допустим","PASS","good"),
                row("✓","Спора об обстоятельствах нет","Green path доступен","PASS","good")
              ].join(""))}
              ${panel("Акцепт клиента EAI","CONSENT AUDIT",[
                row("✓","Документ открыт","Публичная оферта · редакция 1.4","09:41:26","good"),
                row("✓","Галочка установлена","Не была предустановлена","09:41:38","good"),
                row("✓","Акцепт связан с профилем","user 18421 · session 10387","BOUND","good")
              ].join("") + `<div class="g-actions"><span class="g-btn">Открыть оферту</span><span class="g-btn primary">Audit trail</span></div>`)}
            </div>`
        },
        cooperation: {
          status:"2 УЧАСТНИКА · COOPERATIVE", tone:"good", title:"Подтвердить совместное оформление",
          sub:"Granite фиксирует, что второй водитель находится рядом, участвует в сессии и не оспаривает обстоятельства — это обязательный gate fast flow.",
          body: `
            <div class="g-grid-3">${metric("Режим","Вместе","2 устройства")}${metric("Автомобили","2","без третьих объектов")}${metric("Спор","Нет","ответ клиента EAI")}</div>
            <div class="g-grid-2">
              ${panel("Выбор сценария","PARTICIPATION MODE",[
                row("✓","Оба водителя участвуют","Параллельное заполнение","SELECTED","good"),
                row("✓","Второй водитель рядом","Можно показать QR","READY","good"),
                row("✓","Разногласий нет","Green path остаётся доступен","PASS","good")
              ].join(""))}
              ${panel("Маршрутизация исключений","AUTO ROUTING",`
                <div class="g-reason"><b>Если второй водитель не участвует</b><br>Fast flow не создаёт платёжную сессию. Ответы и GPS переходят в стандартное заявление, а поддержка видит точную причину выхода.</div>
                <div class="g-actions"><span class="g-btn">Decision log</span><span class="g-btn primary">FAST FLOW · ACTIVE</span></div>`)}
            </div>`
        },
        invite: {
          status:"INVITATION READY", tone:"good", title:"Подготовить канал подключения потерпевшего",
          sub:"До выпуска QR Granite сохраняет канал, язык web-сессии и зарезервированную роль стороны B.",
          body: `
            <div class="g-grid-3">${metric("Канал","QR рядом","основной путь")}${metric("Язык B","Русский","можно изменить")}${metric("TTL","10 минут","одноразовый токен")}</div>
            <div class="g-grid-2">
              ${panel("Параметры приглашения","SESSION SETUP",[
                row("✓","Канал: QR","Обычная камера → eai.uz","SELECTED","good"),
                row("✓","Роль стороны B","Потерпевший","RESERVED","good"),
                row("✓","Локаль интерфейса","Русский","ru-UZ","good")
              ].join(""))}
              ${panel("Что увидит поддержка","LIVE CONTEXT",`
                <div class="g-list-row"><span>Стадия</span><b>Ожидаем выпуск QR</b></div>
                <div class="g-list-row"><span>Альтернатива</span><b>Одноразовая web-ссылка</b></div>
                <div class="g-list-row"><span>Retry policy</span><b>3 попытки · новый token</b></div>
                <div class="g-actions"><span class="g-btn">Session diagnostics</span><span class="g-btn primary">Выпустить QR</span></div>`)}
            </div>`
        },
        qr: {
          status:"WEB-СЕССИЯ · CONSENT", tone:"good", title:"Подключить потерпевшего и получить акцепт",
          sub:"Session orchestrator выпускает одноразовый HTTPS-токен. Первый экран eai.uz — оферта v1.4; только после её акцепта открывается MyID.",
          body: `
            <div class="g-grid-3">${metric("Сессия","EA24-7K3P","истекает через 08:34")}${metric("Web-клиент","Chrome","eai.uz · online")}${metric("Оферта B","v1.4 принята","09:43:17")}</div>
            <div class="g-grid-2">
              ${panel("Участники сессии","2 СТОРОНЫ",`
                <div class="g-person-pair">
                  <div class="g-person-card"><header><b>A · Алишер</b><span class="g-badge good">ONLINE</span></header><p>Создал дело<br>QR показан · 09:42:11</p></div>
                  <div class="g-person-card"><header><b>B · Д. Юсупов</b><span class="g-badge good">CONSENT ✓</span></header><p>eai.uz открыт<br>Оферта принята · 09:43:17</p></div>
                </div>`)}
              ${panel("Диагностика подключения","LIVE",[
                row("✓","QR-токен действителен","Повторное использование запрещено","09:42","good"),
                row("✓","HTTPS-токен открыт","Устройство B открыло eai.uz","09:43","good"),
                row("✓","Оферта потерпевшего","v1.4 · checkbox · web session","ACCEPTED","good")
              ].join("") + `<div class="g-actions"><span class="g-btn">Consent audit</span><span class="g-btn primary">Открыть MyID</span></div>`)}
            </div>`
        },
        offer: {
          status:"2 АКЦЕПТА", tone:"good", title:"Зафиксировать согласие с офертой",
          sub:"Клиент EAI принимает оферту в авторизованной сессии без MyID. Акцепт потерпевшего связывается с его MyID-профилем.",
          body: `
            <div class="g-grid-3">${metric("Версия","1.4","29.07.2026")}${metric("Hash","9A7F…31C2","неизменяемый документ")}${metric("Комплект","2 из 2","оба акцепта сохранены")}</div>
            <div class="g-grid-2">
              ${panel("Акцепты участников","AUDIT",[
                row("A","Водитель A принял","device 7C1A · session 10387","09:44:18","good"),
                row("B","Водитель B принял","device 94D2 · session 10387","09:45:02","good"),
                row("✓","Клиент EAI","Active session · MyID не нужен","BOUND","good")
              ].join(""))}
              ${panel("Версия документа","LEGAL",`
                <div class="g-doc-preview"><b>Публичная оферта EAI</b><br><br>Быстрое урегулирование ОСАГО<br>Редакция 1.4<br><br>Электронное оформление ДТП…</div>
                <div class="g-actions"><span class="g-btn">Журнал версий</span><span class="g-btn primary">Открыть PDF</span></div>`)}
            </div>`
        },
        identity: {
          status:"PAYEE VERIFIED", tone:"good", title:"Подтвердить только потерпевшего",
          sub:"MyID нужен будущему получателю выплаты. Клиент EAI уже известен из active session и повторно через MyID не проходит.",
          body: `
            <div class="g-person-pair">
              <div class="g-person-card"><header><b>A · Алишер Каримов</b><span class="g-badge good">EAI SESSION ✓</span></header><p>Клиент · виновник<br>Nexia · 01 Z 748 CB<br>Без повторного MyID</p></div>
              <div class="g-person-card"><header><b>B · Д. Юсупов</b><span class="g-badge good">MYID ✓</span></header><p>Потерпевший · payee<br>Cobalt · 01 A 441 SA<br>Получатель подтверждён</p></div>
            </div>
            <div class="g-grid-2">
              ${panel("Сопоставление источников","SESSION + MYID ↔ ERSP",[
                row("✓","Клиент EAI","Авторизованная сессия и полис","MATCH","good"),
                row("✓","Потерпевший","MyID и будущий payee совпали","MATCH","good"),
                row("✓","Полисы действуют","Куплены более 12 часов назад","MATCH","good")
              ].join(""))}
              ${panel("Ответ ERSP НАПП","09:47:06",`
                <div class="g-list-row"><span>Запрос</span><b>ПИНФЛ + госномер</b></div>
                <div class="g-list-row"><span>Страховщик A</span><b>EAI</b></div>
                <div class="g-list-row"><span>Страховщик B</span><b>Kapital Sug'urta</b></div>
                <div class="g-list-row"><span>Trace ID</span><b>ersp-84f1…921</b></div>
                <div class="g-actions"><span class="g-btn">Открыть trace</span><span class="g-btn primary">AUTO · payee verified</span></div>`)}
            </div>`
        },
        evidence: {
          status:"7 ИЗ 8 КАДРОВ", tone:"warn", title:"Проверить комплект фото и антифрод",
          sub:"Computer vision и antifraud автоматически проверяют ракурсы, camera session, GPS и целостность каждого файла.",
          body: `
            <div class="g-grid-3">${metric("Комплект","7 / 8","один ракурс переснять")}${metric("GPS","± 18 м","оба устройства рядом")}${metric("Галерея","0 файлов","только camera session")}</div>
            <div class="g-grid-2">
              ${panel("Материалы ДТП","CAMERA ONLY",`<div class="g-media-grid"><div class="g-media">Общий план ✓</div><div class="g-media">Авто A ✓</div><div class="g-media bad">Повреждение B<br>размыто</div><div class="g-media">Номера ✓</div><div class="g-media">Дорога ✓</div><div class="g-media">Знак ✓</div><div class="g-media">VIN A ✓</div><div class="g-media">VIN B ✓</div></div>`)}
              ${panel("Сигналы проверки","ANTIFRAUD",[
                row("✓","Источник камеры","In-app camera session","VALID","good"),
                row("✓","Время и место","Все кадры в одном окне","VALID","good"),
                row("!","Кадр B-03","Motion blur · OCR номера 42%","RETAKE","warn")
              ].join("") + `<div class="g-actions"><span class="g-btn">Открыть сигналы модели</span><span class="g-btn primary">AUTO · пересъёмка запрошена</span></div>`)}
            </div>`
        },
        protocol: {
          status:"AUTO · 96.4%", tone:"good", title:"Реконструировать схему ДТП",
          sub:"Collision Reconstruction AI строит траектории и положение автомобилей по материалам, которые уже сняты в приложении. Ручного ввода и подтверждения сторон нет.",
          body: `
            <div class="g-grid-3">${metric("Материалы","8 / 8","camera session valid")}${metric("Confidence","96.4%","выше порога 90%")}${metric("Сценарий","Наезд сзади","определён моделью")}</div>
            <div class="g-grid-2">
              ${panel("Сигналы реконструкции","AI INPUT",`
                <div class="g-list-row"><span>Траектории</span><b class="g-ok">Из видео и ориентации авто</b></div>
                <div class="g-list-row"><span>Зоны удара</span><b class="g-ok">CV damage match</b></div>
                <div class="g-list-row"><span>Дорожная обстановка</span><b class="g-ok">GPS + map context</b></div>
                <div class="g-list-row"><span>Участие водителей</span><b class="g-ok">Не требуется</b></div>`)}
              ${panel("Результат алгоритма","AUTO · COLLISION AI",`
                <div class="g-reason"><b>Схема зафиксирована автоматически</b><br>Версия модели, входные материалы и confidence сохранены в audit trail. Ниже порога — автоматический выход из green path.</div>
                <div class="g-actions"><span class="g-btn">Открыть реконструкцию</span><span class="g-btn primary">AUTO · принято</span></div>`)}
            </div>`
        },
        sign: {
          status:"CONSENT RECORDED", tone:"good", title:"Зафиксировать признание вины клиента",
          sub:"Consent audit сохраняет явную галочку из авторизованной EAI-сессии. Повторный MyID, Face и SMS OTP не используются.",
          body: `
            <div class="g-grid-3">${metric("Виновник","Алишер Каримов","EAI user 4812")}${metric("Метод","Checkbox","active session")}${metric("Акцепт","CNS-882190","09:55:41")}</div>
            <div class="g-grid-2">
              ${panel("Текст подтверждения","VERSION 3",`<div class="g-doc-preview"><b>Я подтверждаю обстоятельства ДТП</b><br><br>Признаю, что совершённый мной манёвр привёл к столкновению, и подтверждаю итоговый европротокол.</div>`)}
              ${panel("Доказательство и отправка","CONSENT AUDIT + ERSP",[
                row("✓","Клиент авторизован","Active EAI session","PASS","good"),
                row("✓","Галочка установлена","Не была предустановлена","PASS","good"),
                row("✓","Текст показан до акцепта","Hash 7D9A…110C","AUDIT","good"),
                row("→","ERSP НАПП","Претензия → файл заявления","ГОТОВО","warn")
              ].join("") + `<div class="g-actions"><span class="g-btn">Открыть audit trail</span><span class="g-btn primary">AUTO · отправка в НАПП</span></div>`)}
            </div>`
        },
        inspection: {
          status:"1 ИЗ 2 ПРИНЯТА", tone:"warn", title:"Проверить две справки из наркодиспансера",
          sub:"Document AI и OCR автоматически принимают обе бумажные справки; до результата 2 из 2 расчёт остаётся заблокирован.",
          body: `
            <div class="g-grid-3">${metric("Справка A","Принята","камера приложения")}${metric("Справка B","На проверке","OCR 71%")}${metric("Расчёт","Заблокирован","до комплекта 2 / 2")}</div>
            <div class="g-grid-2">
              ${panel("Справка потерпевшего","A · ПРИНЯТА",`<div class="g-doc-preview"><b>Городской наркодиспансер</b><br><br>Алишер Каримов<br>Признаков опьянения не выявлено<br><br>№ 001884 · печать ✓</div>`)}
              ${panel("Справка виновника","B · ПРОВЕРИТЬ",`
                <div class="g-doc-preview"><b>Городской наркодиспансер</b><br><br>Д. Юсупов<br>Строка результата распознана не полностью<br><br>№ 001891 · печать ?</div>
                <div class="g-actions"><span class="g-btn">Открыть OCR-сигналы</span><span class="g-btn primary">AUTO · пересъёмка запрошена</span></div>`)}
            </div>`
        },
        decision: {
          status:"AUTO · READY TO PAY", tone:"good", title:"Рассчитать выплату и подготовить реквизиты",
          sub:"Решение выпускается автоматически. Потерпевший видит сумму и вводит PAN на одном экране; Granite получает только токен и результат сверки держателя.",
          body: `
            <div class="g-grid-3">${metric("Расчёт","8 640 000 сум","методология 2.3")}${metric("Получатель","Д. Юсупов","MyID verified")}${metric("Карта","UZCARD •••• 4417","PAN tokenized")}</div>
            <div class="g-grid-2">
              ${panel("Состав выплаты","МЕТОДОЛОГИЯ 2.3",`
                <div class="g-list-row"><span>Бампер передний</span><b>3 200 000 сум</b></div>
                <div class="g-list-row"><span>Фара левая</span><b>2 140 000 сум</b></div>
                <div class="g-list-row"><span>Работы и материалы</span><b>3 300 000 сум</b></div>
                <div class="g-list-row"><span>Итого</span><b>8 640 000 сум</b></div>`)}
              ${panel("Решение и платёжный метод","AI + ERSP + PCI",[
                row("✓","Материалы с места","Camera session + CV","PASS","good"),
                row("✓","Решение в ERSP","UUID получен, PDF отправлен","SENT","good"),
                row("✓","PAN tokenization","Открытый номер не сохранён","TOKEN","good"),
                row("✓","Держатель карты","Совпадает с MyID потерпевшего","MATCH","good")
              ].join("") + `<div class="g-actions"><span class="g-btn">Audit trail</span><span class="g-btn primary">AUTO · создать выплату</span></div>`)}
            </div>`
        },
        card: {
          status:"PAYEE + PAN VERIFIED", tone:"good", title:"Токенизировать карту потерпевшего",
          sub:"PAN уходит напрямую платёжному провайдеру. Granite хранит только токен, маску и результат сверки с MyID-профилем потерпевшего.",
          body: `
            <div class="g-grid-3">${metric("Получатель","Д. Юсупов","MyID verified")}${metric("Карта","UZCARD •••• 4417","PAN tokenized")}${metric("Сумма","8 640 000 сум","готова к выплате")}</div>
            <div class="g-grid-2">
              ${panel("Платёжный метод","TOKEN PM-8841",[
                row("✓","PAN format","16 цифр · Luhn valid","PASS","good"),
                row("✓","Токенизация","Открытый PAN не сохранён","TOKEN","good"),
                row("✓","Держатель","Совпадает с потерпевшим","MATCH","good")
              ].join(""))}
              ${panel("Security boundary","PCI CONTOUR",`
                <div class="g-reason"><b>Granite не видит полный PAN</b><br>Провайдер возвращает token PM-8841, BIN 8600 и last4 4417. Повторное использование ограничено этим получателем.</div>
                <div class="g-actions"><span class="g-btn">Открыть audit trail</span><span class="g-btn primary">AUTO · создать выплату</span></div>`)}
            </div>`
        },
        paid: {
          status:"AUTO · ВЫПЛАТА ИСПОЛНЕНА", tone:"good", title:"Исполнить автоматическую выплату",
          sub:"Payment orchestrator сверяет получателя, создаёт выплату и передаёт её банку без ручного подтверждения; Granite получает статусы 1C, банка и ERSP НАПП.",
          body: `
            <div class="g-grid-2">
              ${panel("Платёж P-10387","ИСПОЛНЕН",`
                <div class="g-amount"><span>Выплачено клиенту</span><b>8 640 000 сум</b></div>
                <div class="g-list-row"><span>Получатель</span><b>Д. Юсупов · потерпевший</b></div>
                <div class="g-list-row"><span>Карта</span><b>Uzcard · •••• 4417</b></div>
                <div class="g-list-row"><span>Bank reference</span><b>UZM-2907-8841</b></div>`)}
              ${panel("Исполнение и отчётность","GRANITE ↔ 1C ↔ ERSP",`
                <div class="g-timeline"><div class="g-timeline-row"><time>10:19</time><i></i><b>PAN токенизирован, получатель сверен</b></div><div class="g-timeline-row"><time>10:20</time><i></i><b>Payment orchestrator создал выплату</b></div><div class="g-timeline-row"><time>10:21</time><i></i><b>Банк исполнил перевод</b></div><div class="g-timeline-row"><time>10:22</time><i></i><b>Выплата и PDF отправлены в ERSP НАПП</b></div><div class="g-timeline-row"><time>≈ 18:00</time><i class="wait"></i><b>1C отразит проводку следующей синхронизацией</b></div></div>
                <div class="g-actions"><span class="g-btn">Открыть машинный audit trail</span><span class="g-btn primary">Статус ERSP · SENT</span></div>`)}
            </div>`
        },
        documents: {
          status:"D+3 · 3 ИЗ 6", tone:"warn", title:"Собрать post-payment пакет по оферте",
          sub:"Выплата уже исполнена. Document orchestrator ведёт отдельные checklist виновника и потерпевшего, проверяет camera-only capture и напоминает до конца третьего дня.",
          body: `
            <div class="g-grid-3">${metric("Дедлайн","01.08.2026 09:41","72 часа от ДТП")}${metric("Получено","3 из 6","выплата не блокируется")}${metric("Последствие срыва","Регресс к виновнику","8 640 000 сум")}</div>
            <div class="g-grid-2">
              ${panel("Кто что должен","2 СТОРОНЫ · 6 ПОЗИЦИЙ",[
                row("!","Справка наркодиспансера · потерпевший","camera only в web-сессии","НУЖНО","warn"),
                row("!","Справка наркодиспансера · виновник","camera only в EAI app","НУЖНО","warn"),
                row("!","Остальные документы · виновник","персональный checklist оферты","НУЖНО","warn"),
                row("✓","Личность обеих сторон","MyID + профиль клиента, скан не запрашиваем","READY","good"),
                row("✓","Фото с места и повреждений","получены до выплаты","READY","good"),
                row("✓","Полис и ТС","подтянуты автоматически","READY","good")
              ].join(""))}
              ${panel("Что произойдёт после дедлайна","РЕГРЕСС · TO-BE",`
                <div class="g-reason"><b>Выплата не отзывается</b><br>Деньги остаются у потерпевшего в любом случае. Если справка показала опьянение или пакет не поступил, Granite формирует требование к клиенту EAI — виновнику.</div>
                <div class="g-list-row"><span>Напоминания</span><b>D+1 · D+2 · SMS + push</b></div>
                <div class="g-list-row"><span>Канал потерпевшего</span><b>новая одноразовая ссылка на сессию</b></div>
                <div class="g-list-row"><span>Должник по регрессу</span><b>Алишер Каримов · клиент EAI</b></div>
                <div class="g-actions"><span class="g-btn">Открыть checklist</span><span class="g-btn primary">AUTO · напоминания включены</span></div>`)}
            </div>`
        },
        regress: {
          status:"TO-BE · НОВЫЙ КОНТУР", tone:"warn", title:"Вести регресс к страховой виновника",
          sub:"Back-office работает с пакетом и ответами другой СК. В текущей кодовой базе отдельного межстрахового recovery-модуля и RBAC для этого процесса пока нет.",
          body: `
            <div class="g-grid-3">${metric("Требование","8 640 000 сум","R-10387")}${metric("Документы","6 из 6","включая 2 справки")}${metric("Срок ответа","14 дней","до 12.08.2026")}</div>
            <div class="g-grid-2">
              ${panel("Состав пакета","КОМПЛЕКТ",[
                row("✓","Европротокол и признание вины","Hash подтверждён","READY","good"),
                row("✓","Две справки","Наркодиспансер · A и B","READY","good"),
                row("✓","Расчёт и платёж","8 640 000 сум","READY","good")
              ].join(""))}
              ${panel("Обмен с другой СК","RECOVERY",`<div class="g-timeline"><div class="g-timeline-row"><time>10:20</time><i></i><b>Требование сформировано</b></div><div class="g-timeline-row"><time>10:24</time><i></i><b>Пакет доставлен</b></div><div class="g-timeline-row"><time>—</time><i class="wait"></i><b>Ожидается ответ другой СК</b></div></div><div class="g-actions"><span class="g-btn">Скачать пакет</span><span class="g-btn primary">Создать напоминание</span></div>`)}
            </div>`
        },
        coverage: {
          status:"AUTO · ПОКРЫТИЕ ✓", tone:"good", title:"Автоматически подтвердить ответственность EAI",
          sub:"Coverage rules сверяют полис на дату ДТП, лимит и исключения по данным Granite, ERSP НАПП и 1C.",
          body: `
            <div class="g-grid-3">${metric("Полис","GAI 7723041","EAI · действующий")}${metric("Лимит","20 000 000 сум","доступно 20 млн")}${metric("Резерв в 1C","Открыт","9 100 000 сум")}</div>
            <div class="g-grid-2">
              ${panel("Проверка покрытия","RULES + ERSP",[
                row("✓","Полис действовал","Дата ДТП внутри периода","PASS","good"),
                row("✓","Куплен заранее","47 дней до события","PASS","good"),
                row("✓","Исключений нет","ТС и водитель допущены","PASS","good")
              ].join(""))}
              ${panel("Ответ ERSP НАПП","TRACE 91AC",`
                <div class="g-list-row"><span>Статус</span><b class="g-ok">Действующий</b></div>
                <div class="g-list-row"><span>Страховщик</span><b>EAI</b></div>
                <div class="g-list-row"><span>Период</span><b>14.03.2026—13.03.2027</b></div>
                <div class="g-list-row"><span>Дата ДТП</span><b>29.07.2026</b></div>
                <div class="g-actions"><span class="g-btn">Открыть trace</span><span class="g-btn primary">AUTO · покрытие подтверждено</span></div>`)}
            </div>`
        },
        incoming: {
          status:"TO-BE · НОВЫЙ КОНТУР", tone:"warn", title:"Разобрать требование другой страховой",
          sub:"Back-office сравнивает входящий расчёт с материалами исходного дела. Экран является целевой моделью: отдельного interinsurer-модуля в Granite пока нет.",
          body: `
            <div class="g-grid-3">${metric("Запрошено","9 020 000 сум","другая СК")}${metric("Подтверждено","8 640 000 сум","по материалам дела")}${metric("Расхождение","380 000 сум","покраска двери")}</div>
            <div class="g-grid-2">
              ${panel("Входящий пакет","5 ДОКУМЕНТОВ",[
                row("✓","Европротокол","Совпадает с делом EA-24-10387","MATCH","good"),
                row("✓","Подтверждение выплаты","9 020 000 сум","RECEIVED","good"),
                row("!","Расчёт ремонта","Добавлена покраска двери","REVIEW","warn")
              ].join(""))}
              ${panel("Решение по требованию","BACK-OFFICE",`
                <div class="g-reason"><b>Расхождение 380 000 сум</b><br>На фото и в первичном акте повреждение двери не зафиксировано.</div>
                <div class="g-actions"><span class="g-btn">Запросить документ</span><span class="g-btn">Отклонить разницу</span><span class="g-btn primary">Подтвердить 8 640 000</span></div>`)}
            </div>`
        },
        reimbursed: {
          status:"TO-BE · BACK-OFFICE + 1C", tone:"warn", title:"Закрыть межстраховое возмещение",
          sub:"Back-office подтверждает сумму, а банк и 1C исполняют и учитывают платёж. Granite должен получить статус и закрыть межстраховой контур — это целевая функциональность.",
          body: `
            <div class="g-grid-3">${metric("Возмещено","8 640 000 сум","другой страховой")}${metric("Резерв","0 сум","закрыт полностью")}${metric("Дело","Закрыто","29.07.2026 · 16:42")}</div>
            <div class="g-grid-2">
              ${panel("Финансовое закрытие","1C + BANK",[
                row("✓","Платёж исполнен","Reference EAI-884102","DONE","good"),
                row("✓","Проводка проведена","Счёт межстраховых расчётов","DONE","good"),
                row("✓","Резерв освобождён","Остаток 0 сум","DONE","good")
              ].join(""))}
              ${panel("История дела","AUDIT",`<div class="g-timeline"><div class="g-timeline-row"><time>14:08</time><i></i><b>Требование подтверждено</b></div><div class="g-timeline-row"><time>16:31</time><i></i><b>Платёж подписан</b></div><div class="g-timeline-row"><time>16:42</time><i></i><b>Дело и резерв закрыты</b></div></div><div class="g-actions"><span class="g-btn">Скачать акт</span><span class="g-btn primary">Открыть проводку</span></div>`)}
            </div>`
        }
      };
      const view = stageViews[item.screen] || stageViews.safety;
      /* До этапа 05 дела ещё нет: Granite держит pre-flight контекст без номера. */
      const preflight = ["scene", "safety", "cooperation", "invite"].includes(item.screen);
      return graniteChrome(`
        <main class="granite-content">
          <div class="granite-breadcrumb"><span>Претензии</span><span>/</span><b>${preflight ? "Новое обращение" : "EA-24-10387"}</b><span>/</span><b>${item.title}</b></div>
          <div class="g-work-head">
            <div><div class="g-work-kicker">ОСАГО · клиент EAI — ${role}</div><h5 class="g-work-title">${view.title}</h5><p class="g-work-sub">${view.sub}</p></div>
            <span class="g-work-status ${view.tone}">${view.status}</span>
          </div>
          ${view.body}
        </main>`, "claims");
    }


let activeIndex = 0;
let activeFlowKey = "culprit";
let activeFlow = flows.culprit;
      function renderSupportConsole(item, ops, support, policy, displayIndex) {
        const caller = policy.owner === "victim" ? "Д. Юсупов · потерпевший" : "Алишер Каримов · виновник · клиент EAI";
        const channel = policy.owner === "victim" ? "web-сессия eai.uz · русский" : "мобильное приложение · русский";
        return `
          <span class="maturity tobe">TO-BE</span>
          <div class="diagram-node-caption">
            <span><b><span class="owner-tag culprit" style="background:#f0edfb;color:#5a44a0">Колл-центр</span>${item.title}</b><small>Поддержка · решение о выплате не принимает</small></span><i>SUPPORT</i>
          </div>
          <div class="diagram-support-crop"><div class="diagram-support-scale">${graniteChrome(`
            <main class="granite-content">
              <div class="granite-breadcrumb"><span>Обращения</span><span>/</span><span>EA-24-10387</span><span>/</span><b>${item.title}</b></div>
              <div class="g-work-head">
                <div><div class="g-work-kicker">ОСАГО · обращение в поддержку</div><h5 class="g-work-title">Помочь продолжить оформление</h5><p class="g-work-sub">Оператор видит контекст дела и следующий шаг. Выплату разрешают правила и алгоритмы, не оператор.</p></div>
                <span class="g-work-status warn">SUPPORT ONLY</span>
              </div>
              <div class="g-grid-3">
                <div class="g-metric"><span>Кто звонит</span><b>${caller}</b><small>${channel}</small></div>
                <div class="g-metric"><span>Остановилось на</span><b>Этап ${displayIndex}</b><small>${item.title}</small></div>
                <div class="g-metric"><span>Последний успешный</span><b>${support.last.split(" · ")[0]}</b><small>${support.last.split(" · ")[1] || ""}</small></div>
              </div>
              <div class="g-grid-2">
                <section class="g-panel">
                  <header class="g-panel-head"><span>Почему остановилось</span><small>${support.code}</small></header>
                  <div class="g-reason"><b>${support.reason}</b><br>${ops.exceptionCopy}</div>
                  <div class="g-list-row"><span>Класс исключения</span><b>${policy.title}</b></div>
                  <div class="g-list-row"><span>Повторы</span><b>${policy.retry}</b></div>
                  <div class="g-list-row"><span>Попытка</span><b>2 из 3 · следующая через 40 сек</b></div>
                  <div class="g-list-row"><span>Выход из fast flow</span><b>${policy.kind === "terminal" ? "уже произошёл" : "после исчерпания повторов"}</b></div>
                </section>
                <section class="g-panel">
                  <header class="g-panel-head"><span>Что уже подтверждено</span><small>AUDIT TRAIL</small></header>
                  <div class="g-list-row"><span>Согласия</span><b>${support.confirmed}</b></div>
                  <div class="g-list-row"><span>Вторая сторона</span><b>${support.other}</b></div>
                  <div class="g-list-row"><span>Телефон</span><b>+998 90 ••• 41 17 <em style="font-style:normal;color:#8a97a6">показать по обоснованию</em></b></div>
                  <div class="g-list-row"><span>ПИНФЛ / PAN</span><b style="color:#8a97a6">скрыты от оператора</b></div>
                  <div class="g-reason"><b>Что сказать</b><br>${support.next}</div>
                  <div class="g-actions"><span class="g-btn">История контактов · 2</span><span class="g-btn primary">Отправить ссылку повторно</span></div>
                </section>
              </div>
            </main>`, "calls")}</div></div>`;
      }



const routeAliases = {
  culprit: { scene:"scene", safety:"safety", cooperation:"cooperation", invite:"invite", qr:"qr", evidence:"evidence", protocol:"protocol", sign:"sign", documents:"documents" },
  victim: { qr:"qr", evidence:"evidence", protocol:"protocol", decision:"decision", paid:"paid", documents:"documents" },
};
const exceptionPolicy = {
  qr:{ kind:"auto", owner:"victim", title:"Авто-повтор", retry:"3 токена · 10 мин, затем выход", detail:"Старый токен инвалидируется, QR обновляется", userDetail:"Ссылка обновляется, попросите второго водителя показать новый QR" },
  evidence:{ kind:"user", owner:"both", title:"Действие водителя", retry:"без лимита · окно 20 мин", detail:"Переснять кадр камерой своей сессии", userDetail:"Переснимите кадр — снимок получился нечитаемым" },
  paid:{ kind:"auto", owner:"victim", title:"Авто-повтор платежа", retry:"3 попытки · 15 мин, затем оператор", detail:"Реквизиты уточняются, платёж повторяется", userDetail:"Банк не принял перевод с первого раза, пробуем снова" },
};
const supportStages = {
  qr:{ reason:"Потерпевший не открыл сессию", code:"WEB_SESSION_TIMEOUT", last:"04 · Способ приглашения", confirmed:"Оферта виновника v1.4 · 09:41:18", other:"Потерпевший: не подключён", next:"Показать QR заново или отправить ссылку по SMS" },
  evidence:{ reason:"Кадр не прошёл проверку качества", code:"MEDIA_QUALITY_LOW", last:"06 · Личность потерпевшего", confirmed:"MyID потерпевшего · 09:46:02", other:"Виновник: 4 из 4 кадров приняты", next:"Переснять общий план камерой сессии" },
  paid:{ reason:"Банк отклонил перевод", code:"PAYOUT_DECLINED_57", last:"10 · Сумма и карта", confirmed:"Решение 8 640 000 сум · 10:18:44", other:"Виновник: действий не требуется", next:"Указать другую карту на имя потерпевшего" },
};
function extractScreen(html, selector) {
  const host = document.createElement("div");
  host.innerHTML = html;
  const screen = host.querySelector(selector);
  if (!screen) throw new Error("Reference screen did not render: " + selector);
  return screen.outerHTML;
}
export function renderReferenceScreen(owner, id) {
  if (owner === "culprit") {
    const key = routeAliases.culprit[id];
    return key && polishedTemplates[key] ? { mode:"phone", html:polishedTemplates[key]() } : null;
  }
  if (owner === "victim") {
    if (id === "identity") return { mode:"phone", html:myidLoginScreen() };
    if (id === "identity-face") return { mode:"phone", html:myidFaceScreen() };
    const key = routeAliases.victim[id];
    return key && victimTemplates[key] ? { mode:"phone", html:victimTemplates[key]() } : null;
  }
  if (owner === "granite") {
    const index = Number(id.replace("stage-", "")) - 1;
    const item = flows.culprit.steps[index];
    if (!item) return null;
    return { mode:"granite", html:extractScreen(renderGraniteWorkspace(item, stageOps[item.screen]), ".granite-window") };
  }
  if (owner === "support") {
    const screen = id === "payout" ? "paid" : id;
    const index = flows.culprit.steps.findIndex((item) => item.screen === screen);
    const item = flows.culprit.steps[index];
    const support = supportStages[screen];
    const policy = exceptionPolicy[screen];
    if (!item || !support || !policy) return null;
    return { mode:"support", html:extractScreen(renderSupportConsole(item, stageOps[screen], support, policy, index + 1), ".granite-window") };
  }
  return null;
}
