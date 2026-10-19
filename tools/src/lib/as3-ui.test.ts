import { describe, expect, it } from 'vitest';
import { extractComponent, globalStyles, outline, type UiComponent } from './as3-ui.ts';

const SAMPLE = `
package Login
{
   public class Demo extends Canvas
   {
      public function Demo()
      {
         _documentDescriptor_ = new UIComponentDescriptor({
            "type":Canvas,
            "propertiesFactory":function():Object
            {
               return {
                  "width":1000,
                  "childDescriptors":[new UIComponentDescriptor({
                     "type":Image,
                     "propertiesFactory":function():Object
                     {
                        return {"source":_embed_mxml_images_board_login_jpg_1633673007,"x":-2.5};
                     }
                  }),new UIComponentDescriptor({
                     "type":Button,
                     "id":"okButton",
                     "events":{"click":"__okButton_click"},
                     "stylesFactory":function():void
                     {
                        this.fontSize = 12;
                        this.color = 16777215;
                     },
                     "propertiesFactory":function():Object
                     {
                        return {"x":453,"styleName":"NormalButton","visible":true};
                     }
                  })]
               };
            }
         });
         super();
         this.styleDeclaration.defaultFactory = function():void
         {
            this.backgroundColor = 0;
         };
         this.width = 1000;
         this.verticalScrollPolicy = "off";
      }

      private function _Demo_bindingsSetup() : Array
      {
         binding = new Binding(this,function():String
         {
            var _loc1_:* = Global.i18n("Login_Other_7");
            return _loc1_ == undefined ? null : String(_loc1_);
         },function(param1:String):void
         {
            okButton.label = param1;
         },"okButton.label");
         binding = new Binding(this,function():Boolean
         {
            return !autoLogin;
         },function(param1:Boolean):void
         {
            okButton.visible = param1;
         },"okButton.visible");
      }

      mx_internal function _Demo_StylesInit() : void
      {
         style = StyleManager.getStyleDeclaration(".NormalButton");
         if(style.factory == null)
         {
            style.factory = function():void
            {
               this.upSkin = _embed_css_images_button_red_png_1958813944;
               this.fontWeight = "bold";
            };
         }
      }

      public function __okButton_click(param1:MouseEvent) : void
      {
         onLogin();
      }
   }
}
`;

describe('extractComponent', () => {
  const c = extractComponent('Login.Demo', SAMPLE);

  it('parses the descriptor tree', () => {
    expect(c.root?.type).toBe('Canvas');
    expect(c.root?.props).toEqual({ width: 1000 });
    const [image, button] = c.root!.children;
    expect(image).toMatchObject({
      type: 'Image',
      props: { source: { $ref: '_embed_mxml_images_board_login_jpg_1633673007' }, x: -2.5 },
    });
    expect(button).toMatchObject({
      type: 'Button',
      id: 'okButton',
      props: { x: 453, styleName: 'NormalButton', visible: true },
      styles: { fontSize: 12, color: 16777215 },
      events: { click: '__okButton_click' },
    });
  });

  it('collects constructor props, bindings, styles and handlers', () => {
    expect(c.rootProps).toEqual({ width: 1000, verticalScrollPolicy: 'off' });
    expect(c.bindings).toEqual([
      { target: 'okButton.label', expr: 'Global.i18n("Login_Other_7")' },
      { target: 'okButton.visible', expr: '!autoLogin' },
    ]);
    expect(c.styleDeclarations).toEqual({
      '(self)': { backgroundColor: 0 },
      '.NormalButton': {
        upSkin: { $ref: '_embed_css_images_button_red_png_1958813944' },
        fontWeight: 'bold',
      },
    });
    expect(c.handlers).toEqual({ __okButton_click: 'onLogin();' });
  });

  it('renders a readable outline', () => {
    const text = outline(c, {
      embed: (ref) => (ref.includes('board_login') ? 'images/board_login.jpg' : null),
      text: (key) => (key === 'Login_Other_7' ? '登录游戏' : undefined),
    });
    expect(text).toContain('Image  x=-2.5  source=images/board_login.jpg');
    expect(text).toContain('label={i18n(Login_Other_7)「登录游戏」}');
    expect(text).toContain('@click→onLogin();');
  });
});

describe('globalStyles', () => {
  const uiComponent = (
    className: string,
    styleDeclarations: UiComponent['styleDeclarations'],
  ): UiComponent => ({
    className,
    root: null,
    rootProps: {},
    bindings: [],
    styleDeclarations,
    handlers: {},
  });

  it('merges selectors, resolves embeds and drops runtime values', () => {
    const app = uiComponent('BloodWar', {
      '(self)': { color: 1 },
      Button: { color: 15136376, upSkin: { $ref: '_embed_css_images_button_red_png_1' } },
    });
    const dialog = uiComponent('Login.LoginDialog', {
      Button: { color: 0 },
      '.Tip': { fillColors: [1, 2], skin: { $ref: 'SomeClass' }, bad: [{ $ref: 'x' }] },
    });
    const embed = (ref: string) => (ref.startsWith('_embed_') ? 'images/button_red.png' : null);
    expect(globalStyles([app, dialog], embed)).toEqual({
      Button: { color: 15136376, upSkin: 'images/button_red.png' },
      '.Tip': { fillColors: [1, 2] },
    });
  });
});
